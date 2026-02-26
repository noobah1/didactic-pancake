import { useCallback } from 'react'
import { usePolling } from './use-polling'
import { ServiceAlert } from '@/lib/types'
import { POLL_INTERVALS } from '@/lib/constants'

interface AlertsResponse {
  alerts: ServiceAlert[]
  timestamp: number
  stale?: boolean
}

export function useAlerts() {
  const fetcher = useCallback(async (): Promise<AlertsResponse> => {
    const res = await fetch('/api/alerts')
    if (!res.ok) throw new Error('Failed to fetch alerts')
    return res.json()
  }, [])

  return usePolling(fetcher, POLL_INTERVALS.serviceAlerts)
}
