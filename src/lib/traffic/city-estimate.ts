import { MAX_READING_AGE_MS } from '../constants'
import { RouteTrafficEstimate } from '../types'
import { CITY_PROBE_SETS, CityProbe, CityProbeRoute, getProbe } from './city-probes'
import { fetchFlowReadings, FlowReading, isFlowConfigured } from './tomtom'
import {
  CorridorRoute,
  CORRIDOR_CACHE_TTL,
  MIN_COVERED_FRACTION,
  RawSegment,
  Segment,
  SourceSite,
  TRAFFIC_ESTIMATE_THRESHOLD_SEC,
  TrafficEvidence,
  accumulateExcess,
  assignSegmentSources,
  fetchRouteCorridors,
} from './estimate'

// Road-speed-inferred slowdowns for city bus routes in the top-15 cities —
// the same idea as estimate.ts, pointed at city streets instead of state
// highways, because that's where the gap is: Tallinn's GPS feed covers only
// Tallinn, and no other Estonian city publishes vehicle positions at all, so
// for a rider in Tartu or Narva or Pärnu there was previously no delay signal
// of any kind. See TOMTOM_FLOW_URL in constants.ts for what was checked
// before concluding that.
//
// Two things differ from the intercity pipeline, both because of what the
// upstream provides:
//
//  - What "usual" means. A Tark Tee detector reports a bare speed, so
//    baseline.ts has to learn its road's usual speed from 28 days of its own
//    samples. That isn't available here: TomTom reports a *free-flow* speed,
//    which is the road unimpeded, not the road as it normally is — city
//    traffic sits below free-flow all day with nothing wrong, so comparing
//    against it would have published a phantom slowdown on every city route
//    during every daylight hour (35 vs 50 km/h alone is a ~7 minute claim on
//    a 25-minute route). Learning a baseline instead isn't an option either:
//    samples would cost metered requests, at a rate the budget can't fund.
//    So the comparison here is against the timetable's own implied speed for
//    the stretch — how fast this route is scheduled to cover the distance
//    between these two stops. That has no systematic bias, needs no history,
//    and asks the rider's actual question: is traffic now slower than what
//    my bus's schedule assumes?
//  - No direction range. A detector reports its road's two directions
//    separately with nothing tying either to a bus's direction of travel,
//    which is why estimate.ts reports an honest min-max spread. A probe
//    returns one reading for the segment TomTom matched, so minSeconds and
//    maxSeconds here are equal — a single number, not a collapsed range.
//
// Everything after the ratio — the coverage gate, the materiality threshold,
// the clamp, the "estimated, never confirmed" framing — is deliberately
// shared with estimate.ts rather than reimplemented, so the two can't drift
// into disagreeing about what's worth showing a rider.

// A probe can only stand in for a segment it's actually near, and city
// streets need a far tighter bar than the intercity MAX_REPRESENTATION_M's
// 15km: at that distance one probe would speak for every route in the city.
// This is a walkable few blocks — roughly the spacing between neighbouring
// probes (see PROBE_SEPARATION_FRACTION in the generator), so a segment
// takes the nearest probe or none.
const MAX_PROBE_REPRESENTATION_M = 1_200

// A city's probe budget is only worth spending while someone is looking at
// that city, so corridors are fetched per city and cached the same 6h the
// intercity corridors are — route shapes and schedules are static within a
// service day either way.
const corridorCacheByCity = new Map<string, { data: CorridorRoute[]; timestamp: number }>()

function probeSites(route: CityProbeRoute): SourceSite[] {
  return route.probeIds.map(getProbe).filter((p): p is CityProbe => p != null)
}

async function fetchCityCorridors(cityId: string): Promise<CorridorRoute[]> {
  const now = Date.now()
  const cached = corridorCacheByCity.get(cityId)
  if (cached && now - cached.timestamp < CORRIDOR_CACHE_TTL) return cached.data

  const probeSet = CITY_PROBE_SETS.find((c) => c.cityId === cityId)
  if (!probeSet) return []

  const routes = await fetchRouteCorridors(probeSet.routes, (rawSegments: RawSegment[], route: CityProbeRoute) =>
    assignSegmentSources(rawSegments, probeSites(route), MAX_PROBE_REPRESENTATION_M),
  )
  if (routes === null) return cached?.data || []
  corridorCacheByCity.set(cityId, { data: routes, timestamp: now })
  return routes
}

// How much longer than scheduled this route's in-motion time currently looks,
// given what its probes read. Pure, so the gates are testable without a
// network: null means "nothing worth showing" — either too little of the
// route is actually measured, or the slowdown is too small to be more than
// ordinary traffic variance.
export function estimateCitySegments(
  segments: Segment[],
  readings: Map<string, FlowReading>,
  nowMs: number,
): TrafficEvidence | null {
  const totalSec = segments.reduce((sum, seg) => sum + seg.inMotionSec, 0)
  if (totalSec <= 0) return null

  const excess = accumulateExcess(segments, (probeId, segment) => {
    const reading = readings.get(probeId)
    if (!reading || nowMs - reading.measuredAt > MAX_READING_AGE_MS) return null
    if (reading.currentKmh <= 0) return null
    // Straight-line distance between the two stops, so this understates how
    // far the bus actually drives — which makes the implied speed, and so
    // every slowdown derived from it, conservative in the direction of
    // silence rather than of invented delay.
    if (!segment.distanceM || segment.inMotionSec <= 0) return null

    const scheduledKmh = (segment.distanceM / segment.inMotionSec) * 3.6
    // Traffic moving at or above what the timetable already assumes isn't
    // costing this route anything, even when it's well below the road's
    // free-flow speed — a bus is not scheduled to travel at free-flow. Ratio
    // 1 leaves the segment counted as measured (it is) while contributing no
    // excess, which is what keeps coveredFraction honest.
    if (reading.currentKmh >= scheduledKmh) return { ratio: 1, measuredAt: reading.measuredAt }
    return { ratio: scheduledKmh / reading.currentKmh, measuredAt: reading.measuredAt }
  })

  const coveredFraction = excess.coveredSec / totalSec
  if (coveredFraction < MIN_COVERED_FRACTION) return null

  const seconds = Math.round(excess.excessSec)
  if (seconds < TRAFFIC_ESTIMATE_THRESHOLD_SEC) return null

  return {
    minSeconds: seconds,
    maxSeconds: seconds,
    detectorCount: excess.detectorIds.size,
    coveredFraction,
    observedAt: new Date(excess.freshestMs || nowMs).toISOString(),
  }
}

// Every city route with a material, sufficiently-evidenced slowdown right
// now, for the given cities.
//
// `cityIds` is the rider's own active city selection, in their order, and is
// load-bearing rather than a filter applied at the end: probing a city costs
// real requests against a metered API (see TOMTOM_DAILY_REQUEST_BUDGET), so
// only the cities actually being looked at get probed, and when the budget
// runs short it's spent on the first ones named. An empty list probes
// nothing — that's what background callers (the push checker) pass, since a
// route-level road-speed inference isn't what those alert on.
export async function computeCityTrafficEstimates(cityIds: string[]): Promise<RouteTrafficEstimate[]> {
  if (!isFlowConfigured() || cityIds.length === 0) return []

  const sets = cityIds.map((id) => CITY_PROBE_SETS.find((c) => c.cityId === id)).filter((s) => s != null)
  if (sets.length === 0) return []

  // One flat, priority-ordered probe list rather than per-city fetches: the
  // per-cycle and daily caps live in the client, and it can only honour the
  // rider's ordering if it sees every probe it might spend on at once.
  const readings = await fetchFlowReadings(sets.flatMap((s) => s.probes))
  if (readings.size === 0) return []

  const now = Date.now()
  const estimates: RouteTrafficEstimate[] = []
  const seen = new Set<string>()
  for (const set of sets) {
    const corridors = await fetchCityCorridors(set.cityId)
    for (const route of corridors) {
      // Two selected cities can share a route (a line running between
      // neighbouring towns qualifies as urban to only one of them, but the
      // same estimate would otherwise be pushed twice if it did).
      if (seen.has(route.routeGtfsId)) continue
      const evidence = estimateCitySegments(route.segments, readings, now)
      if (!evidence) continue
      seen.add(route.routeGtfsId)
      estimates.push({
        routeGtfsId: route.routeGtfsId,
        shortName: route.shortName,
        longName: route.longName,
        lat: route.lat,
        lng: route.lng,
        evidence: 'traffic-estimate',
        ...evidence,
      })
    }
  }
  return estimates
}
