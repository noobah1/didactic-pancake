import { NextResponse } from 'next/server'
import { ItineraryConditions } from '@/lib/types'
import { Availability } from '@/lib/feed-status'
import { getBaselines } from '@/lib/traffic/baseline'
import { fetchDetectorReadings, DetectorReading } from '@/lib/traffic/detectors'
import { fetchFlowReadings, FlowReading, isFlowConfigured } from '@/lib/traffic/tomtom'
import { CityProbeSet, getCityProbeSet } from '@/lib/traffic/city-probes'
import { legSegments, estimateLeg, LegStopTiming } from '@/lib/traffic/leg-estimate'

// Leg-scoped counterpart to /api/delays' route-level traffic estimates (see
// computeTrafficEstimates/computeCityTrafficEstimates there) — this endpoint
// estimates the slowdown over exactly the stops each itinerary leg rides,
// not a route's whole representative trip. Deliberately its own endpoint
// rather than folded into /api/plan: itineraries persist in localStorage for
// up to 6 hours (see use-route-plan.ts), and a traffic figure baked in at
// search time would silently outlive the conditions it described. This is
// polled instead, same as every other live signal in the app.

interface LegRequest {
  legIndex: number
  routeGtfsId: string
  stops: LegStopTiming[]
}

interface ItineraryRequest {
  routeId: string
  legs: LegRequest[]
}

interface RouteConditionsBody {
  cities?: string[]
  itineraries?: ItineraryRequest[]
}

interface RouteConditionsResponse {
  conditions: ItineraryConditions[]
  availability: Availability
  timestamp: number
}

function isValidStop(s: unknown): s is LegStopTiming {
  if (!s || typeof s !== 'object') return false
  const stop = s as Record<string, unknown>
  return (
    typeof stop.lat === 'number' &&
    typeof stop.lng === 'number' &&
    (stop.scheduledDeparture === undefined || typeof stop.scheduledDeparture === 'string') &&
    (stop.scheduledArrival === undefined || typeof stop.scheduledArrival === 'string')
  )
}

function isValidLeg(l: unknown): l is LegRequest {
  if (!l || typeof l !== 'object') return false
  const leg = l as Record<string, unknown>
  return (
    typeof leg.legIndex === 'number' &&
    typeof leg.routeGtfsId === 'string' &&
    Array.isArray(leg.stops) &&
    leg.stops.every(isValidStop)
  )
}

function isValidItinerary(it: unknown): it is ItineraryRequest {
  if (!it || typeof it !== 'object') return false
  const itin = it as Record<string, unknown>
  return typeof itin.routeId === 'string' && Array.isArray(itin.legs) && itin.legs.every(isValidLeg)
}

function computeConditions(
  itineraries: ItineraryRequest[],
  detectorReadings: Map<string, DetectorReading>,
  baselines: Map<string, number>,
  flowReadings: Map<string, FlowReading>,
  nowMs: number,
): ItineraryConditions[] {
  return itineraries.map((itinerary) => {
    const legs: ItineraryConditions['legs'] = {}
    let totalMinSeconds = 0
    let totalMaxSeconds = 0

    for (const leg of itinerary.legs) {
      const segments = legSegments(leg.stops)
      const estimate = estimateLeg(leg.routeGtfsId, segments, detectorReadings, baselines, flowReadings, nowMs)
      if (!estimate) continue
      legs[leg.legIndex] = estimate
      totalMinSeconds += estimate.minSeconds
      totalMaxSeconds += estimate.maxSeconds
    }

    return { routeId: itinerary.routeId, legs, totalMinSeconds, totalMaxSeconds }
  })
}

export async function POST(request: Request) {
  let body: RouteConditionsBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const itineraries = body.itineraries
  if (!Array.isArray(itineraries) || !itineraries.every(isValidItinerary)) {
    return NextResponse.json({ error: 'itineraries must be an array of { routeId, legs }' }, { status: 400 })
  }
  const cities = Array.isArray(body.cities) ? body.cities.filter((c): c is string => typeof c === 'string') : []

  if (itineraries.length === 0) {
    const empty: RouteConditionsResponse = { conditions: [], availability: 'live', timestamp: Date.now() }
    return NextResponse.json(empty)
  }

  try {
    const baselines = getBaselines()
    // Same budget-conscious approach as computeCityTrafficEstimates: only the
    // rider's own active cities' probes are worth spending metered TomTom
    // requests on, not every probe nationwide.
    const cityProbes = isFlowConfigured()
      ? cities.map(getCityProbeSet).filter((s): s is CityProbeSet => s != null).flatMap((s) => s.probes)
      : []

    const [detectorResult, flowResult] = await Promise.allSettled([
      fetchDetectorReadings(),
      fetchFlowReadings(cityProbes),
    ])

    // Neither upstream is load-bearing for the other — a Tark Tee outage
    // must not blank out city estimates and vice versa, same reasoning
    // /api/delays applies to its own two traffic sources.
    const detectorReadings = detectorResult.status === 'fulfilled' ? detectorResult.value : new Map<string, DetectorReading>()
    const flowReadings = flowResult.status === 'fulfilled' ? flowResult.value : new Map<string, FlowReading>()
    const bothFailed = detectorResult.status === 'rejected' && flowResult.status === 'rejected'

    const conditions = computeConditions(itineraries, detectorReadings, baselines, flowReadings, Date.now())
    const response: RouteConditionsResponse = {
      conditions,
      availability: bothFailed ? 'unavailable' : 'live',
      timestamp: Date.now(),
    }
    return NextResponse.json(response)
  } catch {
    const failed: RouteConditionsResponse = { conditions: [], availability: 'unavailable', timestamp: Date.now() }
    return NextResponse.json(failed, { status: 200 })
  }
}
