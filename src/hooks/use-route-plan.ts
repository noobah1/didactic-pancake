import { useState, useCallback } from 'react'
import { RouteResult, TransportMode } from '@/lib/types'

interface PlanResponse {
  routes: RouteResult[]
  error?: string
}

export function useRoutePlan() {
  const [routes, setRoutes] = useState<RouteResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = useCallback(
    async (fromPlace: string, toPlace: string, modes: TransportMode[], dateTime?: string) => {
      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          fromPlace,
          toPlace,
          modes: modes.join(','),
          ...(dateTime ? { dateTime } : {}),
        })

        const res = await fetch(`/api/plan?${params}`)
        const data: PlanResponse = await res.json()

        if (data.error) {
          setError(data.error)
          setRoutes([])
        } else {
          setRoutes(data.routes)
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
  }, [])

  return { routes, loading, error, search, clear }
}
