import { useCallback } from 'react'
import { usePolling } from './use-polling'
import { CityDef, POLL_INTERVALS } from '@/lib/constants'
import { RouteResult, ItineraryConditions } from '@/lib/types'
import { Availability, resolveFeedStatus } from '@/lib/feed-status'

interface RouteConditionsResponse {
  conditions: ItineraryConditions[]
  availability?: Availability
  timestamp: number
}

// Leg-scoped counterpart to useDelays' route-level `estimates` — polls
// /api/route-conditions for exactly the itineraries currently on screen, so
// each RouteCard can show the slowdown for the stops its own legs ride
// rather than a whole route's representative trip. Deliberately its own poll
// (not folded into useDelays): it needs the current search's itineraries as
// input, which useDelays has no reason to know about.
export function useRouteConditions(routes: RouteResult[], cities: CityDef[] = []) {
  const cityIds = cities.map((c) => c.id).join(',')
  // A minimal, stable key for the fetcher's own identity — usePolling
  // re-fetches immediately whenever the fetcher's identity changes (see its
  // own comment), so this must change if and only if the actual request body
  // would. Itinerary ids alone are enough: a itinerary's own stop chain
  // never changes after a search without also getting a new id.
  const routeIds = routes.map((r) => r.id).join(',')

  const fetcher = useCallback(async (): Promise<RouteConditionsResponse> => {
    const itineraries = routes.map((route) => ({
      routeId: route.id,
      legs: route.legs
        .map((leg, legIndex) => ({ leg, legIndex }))
        .filter(({ leg }) => leg.mode !== 'walk' && leg.routeGtfsId)
        .map(({ leg, legIndex }) => ({
          legIndex,
          routeGtfsId: leg.routeGtfsId as string,
          stops: [leg.from, ...(leg.intermediateStops || []), leg.to].map((s) => ({
            lat: s.lat,
            lng: s.lng,
            scheduledDeparture: s.scheduledDeparture,
            scheduledArrival: s.scheduledArrival,
          })),
        })),
    }))

    const res = await fetch('/api/route-conditions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cities: cities.map((c) => c.id), itineraries }),
    })
    if (!res.ok) throw new Error('Failed to fetch route conditions')
    return res.json()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeIds, cityIds])

  const { data, error, lastUpdated } = usePolling(fetcher, POLL_INTERVALS.routeConditions, routes.length > 0)
  return { data, error, lastUpdated, status: resolveFeedStatus(data, error) }
}
