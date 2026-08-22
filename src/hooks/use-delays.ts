import { useCallback } from 'react'
import { usePolling } from './use-polling'
import { CityDef, POLL_INTERVALS } from '@/lib/constants'
import { DelayedVehicle } from '@/app/api/delays/route'
import { Availability, resolveFeedStatus } from '@/lib/feed-status'
import { RouteTrafficEstimate } from '@/lib/types'

interface DelaysResponse {
  vehicles: DelayedVehicle[]
  estimates: RouteTrafficEstimate[]
  timestamp: number
  availability?: Availability
}

// `cities` is the rider's active city selection. Unlike useVehicles', it's
// sent as city ids rather than coordinates, and it doesn't scope what comes
// back — GPS-confirmed delays are nationwide either way, and the caller
// filters by distance. It decides which cities' street-traffic probes the
// server spends its metered request budget on (see
// computeCityTrafficEstimates), so a city nobody is looking at costs nothing.
export function useDelays(cities: CityDef[] = []) {
  const citiesParam = cities.map((c) => c.id).join(',')
  const fetcher = useCallback(async (): Promise<DelaysResponse> => {
    const res = await fetch(citiesParam ? `/api/delays?cities=${encodeURIComponent(citiesParam)}` : '/api/delays')
    if (!res.ok) throw new Error('Failed to fetch delays')
    return res.json()
  }, [citiesParam])

  const { data, error, lastUpdated } = usePolling(fetcher, POLL_INTERVALS.delays)
  return { data, error, lastUpdated, status: resolveFeedStatus(data, error) }
}
