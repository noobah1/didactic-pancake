import { useCallback } from 'react'
import { usePolling } from './use-polling'
import { VehiclePosition, TransportMode } from '@/lib/types'
import { POLL_INTERVALS } from '@/lib/constants'

interface VehicleResponse {
  vehicles: VehiclePosition[]
  timestamp: number
  stale?: boolean
}

export function useVehicles(modes: TransportMode[]) {
  const modesKey = modes.join(',')
  const fetcher = useCallback(async (): Promise<VehicleResponse> => {
    const params = new URLSearchParams({ modes: modesKey })
    const res = await fetch(`/api/vehicles?${params}`)
    if (!res.ok) throw new Error('Failed to fetch vehicles')
    return res.json()
  }, [modesKey])

  return usePolling(fetcher, POLL_INTERVALS.vehiclePositions)
}
