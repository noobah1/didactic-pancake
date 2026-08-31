import { LegTrafficEstimate } from '../types'
import { DetectorSite, getDetectorSite, getRouteCoverage } from './index'
import { CityProbe, getCityProbeRoute, getProbe } from './city-probes'
import { DetectorReading } from './detectors'
import { FlowReading } from './tomtom'
import { MAX_REPRESENTATION_M, RawSegment, Segment, assignSegmentSources, estimateSegments } from './estimate'
import { MAX_PROBE_REPRESENTATION_M, estimateCitySegments } from './city-estimate'

// Points a leg-scoped traffic estimate at exactly the stops a rider's own leg
// rides, instead of RouteTrafficEstimate's whole-route figure — a rider
// boarding a 185km intercity coach for four stops shouldn't be shown the
// slowdown for the whole corridor. Reuses estimate.ts/city-estimate.ts's
// pipelines, gates, and thresholds unchanged; the only new thing here is
// building a leg's own Segment[] and picking which pipeline covers its route.

// The subset of LegPlace a leg-scoped estimate actually needs — deliberately
// narrower than LegPlace itself (no name/stopId/platform) so the client can
// send a trimmed stop list over the wire rather than a whole RouteResult,
// and so a caller building one from scratch (as /api/route-conditions does
// from its request body) isn't forced to invent fields it doesn't have.
// Every real LegPlace satisfies this structurally, so legStops below can
// still be called directly with full LegPlace values.
export interface LegStopTiming {
  lat: number
  lng: number
  scheduledDeparture?: string
  scheduledArrival?: string
}

// Consecutive stop-to-stop pairs over a leg's own stop chain (from →
// intermediateStops → to), using each stop's SCHEDULED time — never the
// realtime-adjusted one, which may already contain today's delay and would
// double-count it (see LegPlace.scheduledDeparture's comment). A stop
// missing a scheduled time, or a non-positive gap, is dropped — mirrors
// fetchRouteCorridors' own segment building in estimate.ts.
export function legSegments(stops: LegStopTiming[]): RawSegment[] {
  const segments: RawSegment[] = []
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i]
    const to = stops[i + 1]
    if (!from.scheduledDeparture || !to.scheduledArrival) continue
    const inMotionSec = (new Date(to.scheduledArrival).getTime() - new Date(from.scheduledDeparture).getTime()) / 1000
    if (inMotionSec <= 0) continue
    segments.push({ fromLat: from.lat, fromLon: from.lng, toLat: to.lat, toLon: to.lng, inMotionSec })
  }
  return segments
}

// The full ordered stop chain for a leg — from, every intermediate stop, to
// — same order a bus actually visits them in.
export function legStops<T extends LegStopTiming>(from: T, intermediateStops: T[] | undefined, to: T): T[] {
  return [from, ...(intermediateStops || []), to]
}

// Which of the two existing pipelines (Tark Tee detectors for intercity/
// regional routes, TomTom probes for city routes) covers this route, if
// either — a route can only ever be in one, never both (see route-coverage.
// json's and city-probes.json's own generation comments).
export function estimateLeg(
  routeGtfsId: string,
  segments: RawSegment[],
  detectorReadings: Map<string, DetectorReading>,
  baselines: Map<string, number>,
  flowReadings: Map<string, FlowReading>,
  nowMs: number,
): LegTrafficEstimate | null {
  if (segments.length === 0) return null

  const coverage = getRouteCoverage(routeGtfsId)
  if (coverage) {
    const candidateSites = coverage.detectors
      .map((d) => getDetectorSite(d.detectorId))
      .filter((s): s is DetectorSite => s != null)
    const assigned: Segment[] = assignSegmentSources(segments, candidateSites, MAX_REPRESENTATION_M)
    const evidence = estimateSegments(assigned, detectorReadings, baselines, nowMs)
    return evidence ? { evidence: 'traffic-estimate', ...evidence } : null
  }

  const probeRoute = getCityProbeRoute(routeGtfsId)
  if (probeRoute) {
    const candidateSites = probeRoute.probeIds.map(getProbe).filter((p): p is CityProbe => p != null)
    const assigned: Segment[] = assignSegmentSources(segments, candidateSites, MAX_PROBE_REPRESENTATION_M)
    const evidence = estimateCitySegments(assigned, flowReadings, nowMs)
    return evidence ? { evidence: 'traffic-estimate', ...evidence } : null
  }

  return null
}
