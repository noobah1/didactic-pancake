import { OTP_BASE_URL, OTP_FETCH_TIMEOUT_MS, MAX_READING_AGE_MS } from '../constants'
import { getServiceDate } from '../service-date'
import { buildRoutesByIdQuery } from '../route-query'
import { distanceMeters, projectOntoSegment } from '../delay'
import { RouteTrafficEstimate } from '../types'
import { ROUTE_COVERAGE, getDetectorSite, DetectorSite, RouteCoverage } from './index'
import { fetchDetectorReadings, DetectorReading, Direction } from './detectors'
import { getBaselines } from './baseline'

// A detector can only stand in for a segment it's actually near — this is
// the same "don't let one lucky highway crossing speak for a 200km corridor"
// concern route-coverage.json's own generation comment describes, just
// applied per-segment instead of per-route.
export const MAX_REPRESENTATION_M = 15_000
// Below this fraction of a route's scheduled in-motion time actually backed
// by a fresh, baselined detector, an estimate would be a handful of sensors
// speaking for a route they mostly don't touch — suppress it rather than
// publish a number that's more extrapolation than measurement.
export const MIN_COVERED_FRACTION = 0.35
// Same bar OVERVIEW_THRESHOLD_SEC uses for GPS-confirmed delays (delay.ts) —
// below this, ordinary traffic variance would put a large fraction of all
// covered routes on the list constantly.
export const TRAFFIC_ESTIMATE_THRESHOLD_SEC = 180
// A detector reading a small fraction of its baseline (e.g. near-stopped
// traffic right at the sensor) must not get extrapolated into an
// implausible multi-hour delay for the whole corridor — cap how much any
// single segment's ratio can contribute.
export const MAX_SLOWDOWN_FACTOR = 3
// Route shapes/schedules are static within a service day — cache far longer
// than the live readings/baselines that get combined with them.
export const CORRIDOR_CACHE_TTL = 6 * 60 * 60_000

export interface Segment {
  inMotionSec: number
  detectorId: string | null
  // Straight-line stop-to-stop distance. Only the city pipeline uses it (to
  // work out how fast the timetable expects this stretch to be covered — see
  // city-estimate.ts); the detector pipeline compares speeds against a
  // learned baseline instead and never needs a distance. Optional so a
  // hand-built Segment in a test doesn't have to invent one.
  distanceM?: number
}

export interface CorridorRoute {
  routeGtfsId: string
  shortName: string
  longName: string
  lat: number
  lng: number
  segments: Segment[]
}

interface GqlStoptime {
  scheduledArrival: number
  scheduledDeparture: number
  stop: { lat: number; lon: number }
}
interface GqlTrip {
  gtfsId: string
  stoptimes: GqlStoptime[]
}
interface GqlPattern {
  tripsForDate: GqlTrip[]
}
interface GqlRouteResponse {
  patterns: GqlPattern[]
}

export interface RawSegment {
  fromLat: number
  fromLon: number
  toLat: number
  toLon: number
  inMotionSec: number
}

// Arrival at the next stop minus departure from this one — dwell time at
// either stop (the gap between a stop's own scheduledArrival and
// scheduledDeparture) is excluded by construction, since dwell doesn't
// stretch with road traffic the way actual travel time does.
export function inMotionSeconds(fromScheduledDeparture: number, toScheduledArrival: number): number {
  return toScheduledArrival - fromScheduledDeparture
}

// A point whose current-vs-usual speed can be measured: a Tark Tee detector
// site here, a TomTom probe point in city-estimate.ts. Both pipelines assign
// them to segments identically, so they share the one implementation below.
export interface SourceSite {
  id: string
  lat: number
  lon: number
}

// Nearest measurement point to each stop-to-stop segment, using the segment
// itself (not the fuller route polyline) as the line to project sites
// onto — reuses delay.ts's own projectOntoSegment, the same primitive
// tarktee.ts borrows for its road-closure matching. Restricted to the
// route's own pre-computed site list (route-coverage.json for detectors,
// city-probes.json for probes) rather than every site nationwide — cheaper,
// and consistent with those files' own route-scoping.
export function assignSegmentSources(
  rawSegments: RawSegment[],
  candidateSites: SourceSite[],
  maxRepresentationM: number,
): Segment[] {
  return rawSegments.map((seg) => {
    let bestId: string | null = null
    let bestDist = Infinity
    for (const site of candidateSites) {
      const { dist } = projectOntoSegment(site.lat, site.lon, seg.fromLat, seg.fromLon, seg.toLat, seg.toLon)
      if (dist < bestDist) {
        bestDist = dist
        bestId = site.id
      }
    }
    return {
      inMotionSec: seg.inMotionSec,
      detectorId: bestId != null && bestDist <= maxRepresentationM ? bestId : null,
      distanceM: distanceMeters(seg.fromLat, seg.fromLon, seg.toLat, seg.toLon),
    }
  })
}

function assignSegmentDetectors(rawSegments: RawSegment[], coverage: RouteCoverage): Segment[] {
  const candidateSites = coverage.detectors
    .map((d) => getDetectorSite(d.detectorId))
    .filter((s): s is DetectorSite => s != null)
  return assignSegmentSources(rawSegments, candidateSites, MAX_REPRESENTATION_M)
}

let corridorCache: { data: CorridorRoute[]; timestamp: number } | null = null

// Stop-to-stop schedule timing for an arbitrary set of routes, with each
// segment assigned to whichever measurement point speaks for it. Shared by
// both estimate pipelines — the intercity one below (Tark Tee detectors) and
// the city one (TomTom probes, see city-estimate.ts) — since the only thing
// that differs between them is which sites a segment may be assigned to.
// Returns null (rather than an empty list) when the upstream query fails, so
// a caller can tell "OTP is down, keep what you had" apart from "these routes
// genuinely have no usable segments today."
export async function fetchRouteCorridors<T extends { routeGtfsId: string; shortName: string; longName: string }>(
  coverages: T[],
  assign: (rawSegments: RawSegment[], coverage: T) => Segment[],
): Promise<CorridorRoute[] | null> {
  if (coverages.length === 0) return []
  try {
    const ids = coverages.map((r) => r.routeGtfsId)
    const date = getServiceDate()
    const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: buildRoutesByIdQuery(ids, { includeGeometry: false }), variables: { date } }),
      cache: 'no-store',
      signal: AbortSignal.timeout(OTP_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const data = await response.json()
    if (data.errors?.length) return null

    const routes: CorridorRoute[] = []
    coverages.forEach((coverage, i) => {
      const route = data.data?.[`r${i}`] as GqlRouteResponse | null
      if (!route) return

      // A route can have a handful of pattern variants (peak-only
      // extensions etc.) — the one running the most trips today is this
      // route's representative shape for corridor coverage purposes, same
      // "pick the one that actually matters" spirit as SCHEDULE_QUERY's own
      // trip pooling in delays/route.ts.
      let bestTrips: GqlTrip[] = []
      for (const pattern of route.patterns) {
        if (pattern.tripsForDate.length > bestTrips.length) bestTrips = pattern.tripsForDate
      }
      if (bestTrips.length === 0) return

      const trip = bestTrips.reduce((a, b) => (b.stoptimes.length > a.stoptimes.length ? b : a))
      if (trip.stoptimes.length < 2) return

      const rawSegments: RawSegment[] = []
      for (let s = 0; s < trip.stoptimes.length - 1; s++) {
        const from = trip.stoptimes[s]
        const to = trip.stoptimes[s + 1]
        const inMotionSec = inMotionSeconds(from.scheduledDeparture, to.scheduledArrival)
        if (inMotionSec <= 0) continue
        rawSegments.push({ fromLat: from.stop.lat, fromLon: from.stop.lon, toLat: to.stop.lat, toLon: to.stop.lon, inMotionSec })
      }
      if (rawSegments.length === 0) return

      const segments = assign(rawSegments, coverage)
      // Midpoint stop of the representative trip — good enough for "roughly
      // where is this route," the same bar tarktee.ts's own disruption
      // midpoint uses.
      const midStop = trip.stoptimes[Math.floor(trip.stoptimes.length / 2)].stop
      routes.push({
        routeGtfsId: coverage.routeGtfsId,
        shortName: coverage.shortName,
        longName: coverage.longName,
        lat: midStop.lat,
        lng: midStop.lon,
        segments,
      })
    })

    return routes
  } catch {
    return null
  }
}

// The above, for every route in ROUTE_COVERAGE — batched into one OTP
// request via the same aliased-route-id query trip-stops uses (see
// route-query.ts), scoped to exactly the 251 covered routes, not nationwide,
// and without pattern geometry, which this feature never needs (see
// buildRoutesByIdQuery's includeGeometry option).
async function fetchCorridors(): Promise<CorridorRoute[]> {
  const now = Date.now()
  if (corridorCache && now - corridorCache.timestamp < CORRIDOR_CACHE_TTL) {
    return corridorCache.data
  }
  const routes = await fetchRouteCorridors(ROUTE_COVERAGE, assignSegmentDetectors)
  if (routes === null) return corridorCache?.data || []
  corridorCache = { data: routes, timestamp: now }
  return routes
}

interface DirectionExcess {
  excessSec: number
  coveredSec: number
  detectorIds: Set<string>
  freshestMs: number
}

// How much slower than expected one measurement point currently reads, and
// when that reading was taken. The two sources this pipeline has define
// "expected" differently — a Tark Tee detector's current speed against a
// baseline learned from 28 days of its own samples (below), a TomTom probe's
// current speed against the speed this route's own timetable implies for the
// stretch (see city-estimate.ts) — but everything after the ratio is
// identical, so it's computed once here rather than twice.
export interface SegmentRatio {
  ratio: number
  measuredAt: number
}

// Sum of (segment in-motion time) x (how much slower than usual the segment's
// own measurement point currently reads). Pure: `resolve` returns null for a
// segment with no usable reading, and that segment contributes to neither the
// excess nor the covered time — which is what makes coveredFraction a real
// "how much of this route did we actually measure" number rather than a
// count of segments we happened to have geometry for.
export function accumulateExcess(
  segments: Segment[],
  resolve: (sourceId: string, segment: Segment) => SegmentRatio | null,
): DirectionExcess {
  let excessSec = 0
  let coveredSec = 0
  const detectorIds = new Set<string>()
  let freshestMs = 0

  for (const seg of segments) {
    if (!seg.detectorId) continue
    const resolved = resolve(seg.detectorId, seg)
    if (!resolved) continue
    const ratio = Math.min(Math.max(resolved.ratio, 1), MAX_SLOWDOWN_FACTOR)
    excessSec += seg.inMotionSec * (ratio - 1)
    coveredSec += seg.inMotionSec
    detectorIds.add(seg.detectorId)
    freshestMs = Math.max(freshestMs, resolved.measuredAt)
  }

  return { excessSec, coveredSec, detectorIds, freshestMs }
}

// Sum of (segment in-motion time) x (how much slower than baseline the
// nearest detector currently reads), under one direction's calibration —
// see estimateSegments for why both directions get computed separately
// rather than picked between.
export function computeDirectionExcess(
  segments: Segment[],
  readings: Map<string, DetectorReading>,
  baselines: Map<string, number>,
  direction: Direction,
  nowMs: number,
): DirectionExcess {
  return accumulateExcess(segments, (detectorId) => {
    const reading = readings.get(detectorId)
    if (!reading || nowMs - reading.measuredAt > MAX_READING_AGE_MS) return null
    const dirReading = direction === 'forwards' ? reading.forwards : reading.backwards
    if (!dirReading || dirReading.avgSpeedKmh <= 0) return null
    const baseline = baselines.get(`${detectorId}|${direction}`)
    if (!baseline || baseline <= 0) return null
    return { ratio: baseline / dirReading.avgSpeedKmh, measuredAt: reading.measuredAt }
  })
}

export interface TrafficEvidence {
  minSeconds: number
  maxSeconds: number
  detectorCount: number
  coveredFraction: number
  observedAt: string
}

// Tark Tee's forwards/backwards readings are relative to road kilometrage,
// with nothing tying either one to a given route's actual direction of
// travel (see traffic/index.ts and the plan this shipped from). Rather than
// guess, this computes the excess under both calibrations and reports the
// honest range — symmetric traffic collapses it to effectively one number,
// a one-direction jam reports as a real "5-14 min" spread.
export function estimateSegments(
  segments: Segment[],
  readings: Map<string, DetectorReading>,
  baselines: Map<string, number>,
  nowMs: number,
): TrafficEvidence | null {
  const totalSec = segments.reduce((sum, seg) => sum + seg.inMotionSec, 0)
  if (totalSec <= 0) return null

  const fwd = computeDirectionExcess(segments, readings, baselines, 'forwards', nowMs)
  const bwd = computeDirectionExcess(segments, readings, baselines, 'backwards', nowMs)

  const coveredFraction = Math.max(fwd.coveredSec, bwd.coveredSec) / totalSec
  if (coveredFraction < MIN_COVERED_FRACTION) return null

  const minSeconds = Math.round(Math.min(fwd.excessSec, bwd.excessSec))
  const maxSeconds = Math.round(Math.max(fwd.excessSec, bwd.excessSec))
  if (maxSeconds < TRAFFIC_ESTIMATE_THRESHOLD_SEC) return null

  const detectorIds = new Set<string>([...fwd.detectorIds, ...bwd.detectorIds])
  const freshestMs = Math.max(fwd.freshestMs, bwd.freshestMs) || nowMs

  return {
    minSeconds,
    maxSeconds,
    detectorCount: detectorIds.size,
    coveredFraction,
    observedAt: new Date(freshestMs).toISOString(),
  }
}

// Every covered route with a material, sufficiently-evidenced slowdown right
// now. Computed fresh each call (corridor geometry, detector readings, and
// baselines are each independently cached at the layer that actually needs
// caching — see fetchCorridors/fetchDetectorReadings/getBaselines) — called
// once per computeDelays() cycle in src/app/api/delays/route.ts.
export async function computeTrafficEstimates(): Promise<RouteTrafficEstimate[]> {
  const baselines = getBaselines()
  // No learned baselines yet (fresh deploy — see traffic/sampler.ts) means
  // nothing to compare a live reading against; don't bother fetching
  // corridors/readings at all.
  if (baselines.size === 0) return []

  const [corridors, readings] = await Promise.all([fetchCorridors(), fetchDetectorReadings()])
  if (corridors.length === 0 || readings.size === 0) return []

  const now = Date.now()
  const estimates: RouteTrafficEstimate[] = []
  for (const route of corridors) {
    const evidence = estimateSegments(route.segments, readings, baselines, now)
    if (!evidence) continue
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
  return estimates
}
