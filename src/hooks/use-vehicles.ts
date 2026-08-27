import { useCallback } from 'react'
import { usePolling } from './use-polling'
import { VehiclePosition, TransportMode } from '@/lib/types'
import { POLL_INTERVALS, CityDef } from '@/lib/constants'
import { Availability, resolveFeedStatus } from '@/lib/feed-status'

interface VehicleResponse {
  vehicles: VehiclePosition[]
  timestamp: number
  availability?: Availability
}

export function useVehicles(modes: TransportMode[], cities: CityDef[] = [], enabled: boolean = true) {
  const modesKey = modes.join(',')
  // Cities parameter format: "lat,lng;lat,lng;..." or empty string for nationwide
  const citiesParam = cities.length > 0 ? cities.map((c) => `${c.lat},${c.lng}`).join(';') : ''
  const fetcher = useCallback(async (): Promise<VehicleResponse> => {
    const params = new URLSearchParams({ modes: modesKey })
    // Empty citiesParam means nationwide (all cities selected or none selected)
    if (citiesParam) {
      params.set('cities', citiesParam)
    }
    const res = await fetch(`/api/vehicles?${params}`)
    if (!res.ok) throw new Error('Failed to fetch vehicles')
    return res.json()
  }, [modesKey, citiesParam])

  const { data, error, lastUpdated } = usePolling(fetcher, POLL_INTERVALS.vehiclePositions, enabled)
  return { data, error, lastUpdated, status: resolveFeedStatus(data, error) }
}
