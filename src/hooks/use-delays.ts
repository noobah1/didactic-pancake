import { useCallback } from 'react'
import { usePolling } from './use-polling'
import { POLL_INTERVALS } from '@/lib/constants'
import { DelayedVehicle } from '@/app/api/delays/route'
import { Availability, resolveFeedStatus } from '@/lib/feed-status'
import { RouteTrafficEstimate } from '@/lib/types'

interface DelaysResponse {
  vehicles: DelayedVehicle[]
  estimates: RouteTrafficEstimate[]
  timestamp: number
  availability?: Availability
}

export function useDelays() {
  const fetcher = useCallback(async (): Promise<DelaysResponse> => {
    const res = await fetch('/api/delays')
    if (!res.ok) throw new Error('Failed to fetch delays')
    return res.json()
  }, [])

  const { data, error, lastUpdated } = usePolling(fetcher, POLL_INTERVALS.delays)
  return { data, error, lastUpdated, status: resolveFeedStatus(data, error) }
}
