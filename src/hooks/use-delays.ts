import { useCallback } from 'react'
import { usePolling } from './use-polling'
import { POLL_INTERVALS } from '@/lib/constants'
import { DelayedVehicle } from '@/app/api/delays/route'

interface DelaysResponse {
  vehicles: DelayedVehicle[]
  timestamp: number
}

export function useDelays() {
  const fetcher = useCallback(async (): Promise<DelaysResponse> => {
    const res = await fetch('/api/delays')
    if (!res.ok) throw new Error('Failed to fetch delays')
    return res.json()
  }, [])

  return usePolling(fetcher, POLL_INTERVALS.delays)
}
