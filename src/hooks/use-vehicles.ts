import { useCallback } from 'react'
import { usePolling } from './use-polling'
import { VehiclePosition, TransportMode } from '@/lib/types'
import { POLL_INTERVALS, CityDef } from '@/lib/constants'

interface VehicleResponse {
  vehicles: VehiclePosition[]
  timestamp: number
  stale?: boolean
}

export function useVehicles(modes: TransportMode[], cities: CityDef[] = []) {
  const modesKey = modes.join(',')
  const fetcher = useCallback(async (): Promise<VehicleResponse> => {
    if (cities.length === 0) {
      return { vehicles: [], timestamp: Date.now() }
    }
    const params = new URLSearchParams({ modes: modesKey })
    params.set('cities', cities.map((c) => `${c.lat},${c.lng}`).join(';'))
    const res = await fetch(`/api/vehicles?${params}`)
    if (!res.ok) throw new Error('Failed to fetch vehicles')
    return res.json()
  }, [modesKey, cities])

  return usePolling(fetcher, POLL_INTERVALS.vehiclePositions)
}
