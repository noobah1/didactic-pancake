import { useState, useCallback, useEffect, useRef } from 'react'
import { RouteResult, TransportMode } from '@/lib/types'
import { useTranslation } from '@/lib/i18n/context'

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
  const { t } = useTranslation()
  // Always starts empty — matching what the server rendered — so hydration
  // never has to reconcile a client-only localStorage read against SSR
  // output. The stored journey (if any) is applied a moment later in the
  // mount effect below, purely on the client.
  const [routes, setRoutes] = useState<RouteResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    // The mount's own render already matches this (both empty) — saving it
    // here would just overwrite whatever the hydration effect below is
    // about to restore, an instant before it gets the chance to.
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    saveStored({ routes, notice, selectedRouteId })
  }, [routes, notice, selectedRouteId])

  useEffect(() => {
    const stored = loadStored()
    if (!stored) return
    setRoutes(stored.routes)
    setNotice(stored.notice)
    setSelectedRouteId(stored.selectedRouteId)
  }, [])

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
        setError(t('page.routePlanningUnavailable'))
        setRoutes([])
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  const clear = useCallback(() => {
    setRoutes([])
    setError(null)
    setNotice(null)
    setSelectedRouteId(null)
  }, [])

  // Hydrates a single journey received via a share link — no OTP call
  // needed, it's already a fully-formed RouteResult, so it goes straight
  // into the same state a live search would have left behind.
  const loadSharedRoute = useCallback((route: RouteResult) => {
    setLoading(false)
    setError(null)
    setNotice(null)
    setRoutes([route])
    setSelectedRouteId(route.id)
  }, [])

  const setShareError = useCallback((message: string) => {
    setLoading(false)
    setError(message)
    setNotice(null)
    setRoutes([])
    setSelectedRouteId(null)
  }, [])

  return {
    routes,
    loading,
    error,
    notice,
    search,
    clear,
    selectedRouteId,
    selectRoute: setSelectedRouteId,
    loadSharedRoute,
    setShareError,
  }
}
