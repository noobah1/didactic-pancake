import { useState, useCallback, useEffect } from 'react'
import { RouteResult, TransportMode } from '@/lib/types'

interface PlanResponse {
  routes: RouteResult[]
  error?: string
  notice?: string
}

const STORAGE_KEY = 'route-plan-state'
// A refresh mid-trip should bring the journey right back, but reopening the
// app hours later (departure times long past) shouldn't resurrect a dead
// plan — so stored state expires instead of persisting forever.
const STORAGE_MAX_AGE_MS = 6 * 60 * 60 * 1000

interface StoredState {
  routes: RouteResult[]
  notice: string | null
  selectedRouteId: string | null
  savedAt: number
}

function loadStored(): StoredState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredState
    if (Date.now() - parsed.savedAt > STORAGE_MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function saveStored(state: Omit<StoredState, 'savedAt'>) {
  if (typeof window === 'undefined') return
  try {
    if (state.routes.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, savedAt: Date.now() }))
    }
  } catch {
    // localStorage can be unavailable (private browsing, full quota) —
    // persistence is a nice-to-have, not worth failing the search over.
  }
}

export function useRoutePlan() {
  const [routes, setRoutes] = useState<RouteResult[]>(() => loadStored()?.routes || [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(() => loadStored()?.notice || null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(() => loadStored()?.selectedRouteId || null)

  useEffect(() => {
    saveStored({ routes, notice, selectedRouteId })
  }, [routes, notice, selectedRouteId])

  const search = useCallback(
    async (
      fromPlace: string,
      toPlace: string,
      modes: TransportMode[],
      dateTime?: string,
      arriveBy?: boolean,
      bannedTrips?: string[],
    ) => {
      setLoading(true)
      setError(null)
      setNotice(null)

      try {
        const params = new URLSearchParams({
          fromPlace,
          toPlace,
          modes: modes.join(','),
          ...(dateTime ? { dateTime } : {}),
          ...(arriveBy ? { arriveBy: 'true' } : {}),
          ...(bannedTrips?.length ? { bannedTrips: bannedTrips.join(',') } : {}),
        })

        const res = await fetch(`/api/plan?${params}`)
        const data: PlanResponse = await res.json()

        if (data.error) {
          setError(data.error)
          setRoutes([])
        } else {
          setRoutes(data.routes)
          setNotice(data.notice || null)
        }
      } catch {
        setError('Route planning service unavailable')
        setRoutes([])
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const clear = useCallback(() => {
    setRoutes([])
    setError(null)
    setNotice(null)
    setSelectedRouteId(null)
  }, [])

  return { routes, loading, error, notice, search, clear, selectedRouteId, selectRoute: setSelectedRouteId }
}
