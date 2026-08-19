import { useCallback } from 'react'
import { usePolling } from './use-polling'
import { NearbyStopsData } from '@/lib/types'
import { POLL_INTERVALS } from '@/lib/constants'
import { GeoPosition } from './use-geolocation'

export function useNearbyStops(position: GeoPosition | null) {
  // Keyed on the primitive lat/lng, not the position object — usePolling
  // re-fetches immediately whenever the fetcher's identity changes
  // (use-polling.ts), so a fresh object reference on every render would
  // otherwise restart the poll continuously.
  const lat = position?.lat ?? null
  const lng = position?.lng ?? null

  const fetcher = useCallback(async (): Promise<NearbyStopsData> => {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) })
    const res = await fetch(`/api/nearby-stops?${params}`)
    if (!res.ok) throw new Error('Failed to fetch nearby stops')
    return res.json()
  }, [lat, lng])

  return usePolling(fetcher, POLL_INTERVALS.nearbyStops, lat != null && lng != null)
}
