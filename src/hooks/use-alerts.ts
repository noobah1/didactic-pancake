import { useCallback } from 'react'
import { usePolling } from './use-polling'
import { ServiceAlert } from '@/lib/types'
import { POLL_INTERVALS } from '@/lib/constants'
import { Availability, resolveFeedStatus } from '@/lib/feed-status'

interface AlertsResponse {
  alerts: ServiceAlert[]
  timestamp: number
  availability?: Availability
}

export function useAlerts(test?: boolean) {
  const fetcher = useCallback(async (): Promise<AlertsResponse> => {
    const url = test ? '/api/alerts?test=1' : '/api/alerts'
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to fetch alerts')
    return res.json()
  }, [test])

  const { data, error, lastUpdated } = usePolling(fetcher, POLL_INTERVALS.serviceAlerts)
  return { data, error, lastUpdated, status: resolveFeedStatus(data, error) }
}
