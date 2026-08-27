import { NextResponse } from 'next/server'
import {
  GPS_FEED_URL,
  OTP_BASE_URL,
  OTP_FETCH_TIMEOUT_MS,
  GPS_FEED_TIMEOUT_MS,
  ELRON_AGENCY_GTFS_ID,
} from '@/lib/constants'
import { parseGpsFeed } from '@/lib/parse-gps'
import { fetchElronVehicles } from '@/lib/elron'
import { decodePolyline } from '@/lib/decode-polyline'
import { getServiceDate, getServiceSeconds } from '@/lib/service-date'
import { VehiclePosition, TransportMode } from '@/lib/types'
import { findNearestPointIndex, calcHeading, interpolateAlongShape } from '@/lib/shape-geometry'
import { consensusFor, reportedTripIds } from '@/lib/rider-reports'
import { measureOffsetSec, decayOffsetSec, OFFSET_NOISE_FLOOR_SEC, OFFSET_MAX_AGE_SEC } from '@/lib/schedule-offset'

let gpsCache: { data: VehiclePosition[]; timestamp: number } | null = null
const GPS_CACHE_TTL = 5_000 // 5 seconds
const SCHEDULED_CACHE_TTL = 30_000 // 30 seconds

// The schedule query used to ask for rail+ferry+bus+tram in one go, and every
// request that found the cache cold paid for the whole thing. Measured against
// a healthy OTP: 46.7MB / 2.5s for all four modes, versus 0.9MB / 0.05s for
// rail+ferry alone — bus and tram are ~98% of the payload, because every one
// of their patterns carries full geometry plus every trip of the whole service
// day.
//
// Splitting them matters because the expensive half is usually thrown away
// unread. Scheduled bus/tram positions are estimates for places with no live
// GPS; inside Tallinn they're dropped in favour of the real GPS feed (see
// isTallinnArea in GET), and then filterByCities drops whatever is left
// outside the rider's selected cities. So for the default Tallinn-only view,
// all 46MB of it is fetched, interpolated, and discarded. Now it's only
// fetched when some selected city can actually display it — see
// needsSurfaceSchedule in GET.
const RAIL_FERRY_QUERY = `
query ActiveRailFerry($date: String!) {
  rail: routes(transportModes: [RAIL]) {
    shortName
    mode
    agency { gtfsId }
    patterns {
      directionId
      patternGeometry { points }
      tripsForDate(serviceDate: $date) {
        gtfsId
        stoptimes {
          scheduledDeparture
          scheduledArrival
          stop { name lat lon }
        }
      }
    }
  }
  ferry: routes(transportModes: [FERRY]) {
    shortName
    mode
    patterns {
      directionId
      patternGeometry { points }
      tripsForDate(serviceDate: $date) {
        gtfsId
        stoptimes {
          scheduledDeparture
          scheduledArrival
          stop { name lat lon }
        }
      }
    }
  }
}
`

const BUS_TRAM_QUERY = `
query ActiveBusTram($date: String!) {
  bus: routes(transportModes: [BUS]) {
    shortName
    mode
    patterns {
      directionId
      patternGeometry { points }
      tripsForDate(serviceDate: $date) {
        gtfsId
        stoptimes {
          scheduledDeparture
          scheduledArrival
          stop { name lat lon }
        }
      }
    }
  }
  tram: routes(transportModes: [TRAM]) {
    shortName
    mode
    patterns {
      directionId
      patternGeometry { points }
      tripsForDate(serviceDate: $date) {
        gtfsId
        stoptimes {
          scheduledDeparture
          scheduledArrival
          stop { name lat lon }
        }
      }
    }
  }
}
`

interface GqlStoptime {
  scheduledDeparture: number
  scheduledArrival: number
  stop: { name: string; lat: number; lon: number }
}

interface GqlTrip {
  gtfsId: string
  stoptimes: GqlStoptime[]
}

interface GqlPattern {
  directionId: number
  patternGeometry?: { points: string } | null
  tripsForDate: GqlTrip[]
}

interface GqlRoute {
  shortName: string
  mode: string
  agency?: { gtfsId: string } | null
  patterns: GqlPattern[]
}

// Everything needed to turn one of Elron's bare live positions (see
// src/lib/elron.ts — a trip id and a coordinate, nothing else) into a full
// vehicle: which line it is, where it's headed, and geometry to read a
// heading off.
interface RailTripInfo {
  line: string
  destination: string
  shapeCoords: [number, number][] | null
}

interface ScheduledResult {
  vehicles: VehiclePosition[]
  // Every Elron trip running today, not just the ones currently mid-journey —
  // a badly delayed train is outside its own scheduled window, which is
  // exactly when its live position matters most.
  railTrips: Map<string, RailTripInfo>
}

function interpolatePosition(
  stoptimes: GqlStoptime[],
  nowSec: number,
  shapeCoords?: [number, number][] | null,
): { lat: number; lng: number; heading: number; destination: string } | null {
  if (stoptimes.length < 2) return null

  const firstDep = stoptimes[0].scheduledDeparture
  const lastArr =
    stoptimes[stoptimes.length - 1].scheduledArrival || stoptimes[stoptimes.length - 1].scheduledDeparture

  if (nowSec < firstDep || nowSec > lastArr) return null

  const destination = stoptimes[stoptimes.length - 1].stop.name

  // Pre-compute shape arrays and stop indices if shape is available
  let shapeLats: number[] | null = null
  let shapeLons: number[] | null = null
  let stopShapeIndices: number[] | null = null
  if (shapeCoords && shapeCoords.length > 1) {
    shapeLats = shapeCoords.map((c) => c[1])
    shapeLons = shapeCoords.map((c) => c[0])
    // Map each stop to its nearest point on the shape, searching forward
    stopShapeIndices = []
    let searchFrom = 0
    for (const st of stoptimes) {
      const idx = findNearestPointIndex(shapeLats, shapeLons, st.stop.lat, st.stop.lon, searchFrom)
      stopShapeIndices.push(idx)
      searchFrom = idx
    }
  }

  for (let i = 0; i < stoptimes.length - 1; i++) {
    const arr = stoptimes[i].scheduledArrival || stoptimes[i].scheduledDeparture
    const dep = stoptimes[i].scheduledDeparture
    const nextArr = stoptimes[i + 1].scheduledArrival || stoptimes[i + 1].scheduledDeparture

    // Train is dwelling at stop i (between arrival and departure)
    if (i > 0 && nowSec >= arr && nowSec < dep) {
      const stop = stoptimes[i].stop
      const heading =
        i < stoptimes.length - 1
          ? calcHeading(stop.lat, stop.lon, stoptimes[i + 1].stop.lat, stoptimes[i + 1].stop.lon)
          : 0
      return { lat: stop.lat, lng: stop.lon, heading, destination }
    }

    // Train is between stop i and stop i+1
    if (nowSec >= dep && nowSec <= nextArr) {
      const fraction = nextArr === dep ? 0 : (nowSec - dep) / (nextArr - dep)
      const fromStop = stoptimes[i].stop
      const toStop = stoptimes[i + 1].stop

      // Use shape geometry if available
      if (shapeLats && shapeLons && stopShapeIndices) {
        const result = interpolateAlongShape(
          shapeLats,
          shapeLons,
          stopShapeIndices[i],
          stopShapeIndices[i + 1],
          fraction,
        )
        return { ...result, destination }
      }

      // Fallback: straight-line interpolation
      const lat = fromStop.lat + (toStop.lat - fromStop.lat) * fraction
      const lng = fromStop.lon + (toStop.lon - fromStop.lon) * fraction
      const heading = calcHeading(fromStop.lat, fromStop.lon, toStop.lat, toStop.lon)
      return { lat, lng, heading, destination }
    }
  }

  return null
}

function mapOtpMode(mode: string): TransportMode {
  switch (mode) {
    case 'RAIL': return 'train'
    case 'FERRY': return 'ferry'
    case 'TRAM': return 'tram'
    case 'TROLLEYBUS': return 'trolleybus'
    default: return 'bus'
  }
}

async function fetchTallinnGpsVehicles(): Promise<VehiclePosition[]> {
  const now = Date.now()
  if (gpsCache && now - gpsCache.timestamp < GPS_CACHE_TTL) {
    return gpsCache.data
  }
  const response = await fetch(GPS_FEED_URL, {
    cache: 'no-store',
    signal: AbortSignal.timeout(GPS_FEED_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`GPS feed returned ${response.status}`)
  const text = await response.text()
  gpsCache = { data: parseGpsFeed(text), timestamp: now }
  return gpsCache.data
}

const EMPTY_SCHEDULED: ScheduledResult = { vehicles: [], railTrips: new Map() }

interface ScheduledSlot {
  cache: { data: ScheduledResult; timestamp: number } | null
  // Concurrent requests share one query instead of each firing its own copy.
  inFlight: Promise<ScheduledResult> | null
  failedAt: number
}

const railFerrySlot: ScheduledSlot = { cache: null, inFlight: null, failedAt: 0 }
const busTramSlot: ScheduledSlot = { cache: null, inFlight: null, failedAt: 0 }

// A failed attempt used to leave the cache untouched — neither its data nor
// its timestamp — so the very next request re-ran the query immediately. With
// every connected client polling this endpoint every 7s
// (POLL_INTERVALS.vehiclePositions), that turned into a self-sustaining
// overload: once OTP was slow enough that the query couldn't finish inside
// OTP_FETCH_TIMEOUT_MS it could never populate the cache, so every poll from
// every client re-fired the single most expensive query in the codebase, which
// kept OTP too saturated to answer anything else. Journey planning, live
// delays and stop search all went down with it and stayed down, because
// nothing in the loop ever backed off. Confirmed live: /api/vehicles returned
// in 8.1-8.25s on every single call, never once faster.
const SCHEDULED_RETRY_AFTER_FAILURE = 60_000

async function fetchScheduled(query: string): Promise<ScheduledResult> {
  const date = getServiceDate()
  const nowSec = getServiceSeconds()

  const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { date } }),
    cache: 'no-store',
    signal: AbortSignal.timeout(OTP_FETCH_TIMEOUT_MS),
  })

  if (!response.ok) throw new Error(`OTP returned ${response.status}`)
  const data = await response.json()
  if (data.errors?.length) throw new Error(`OTP reported query errors`)
  return parseScheduled(data, nowSec)
}

// Serves the cache while it's fresh, joins whatever query is already running
// if one is, and otherwise starts one — but never starts one within
// SCHEDULED_RETRY_AFTER_FAILURE of the last failure. On failure the last
// known-good data is served rather than nothing, so a wobble in OTP degrades
// to slightly stale markers instead of an empty map.
async function loadScheduled(slot: ScheduledSlot, query: string, label: string): Promise<ScheduledResult> {
  const now = Date.now()
  if (slot.cache && now - slot.cache.timestamp < SCHEDULED_CACHE_TTL) return slot.cache.data
  if (slot.inFlight) return slot.inFlight
  if (now - slot.failedAt < SCHEDULED_RETRY_AFTER_FAILURE) return slot.cache?.data ?? EMPTY_SCHEDULED

  slot.inFlight = fetchScheduled(query)
    .then((data) => {
      slot.cache = { data, timestamp: Date.now() }
      slot.failedAt = 0
      return data
    })
    .catch((error) => {
      slot.failedAt = Date.now()
      console.error(`Scheduled ${label} query failed:`, error)
      return slot.cache?.data ?? EMPTY_SCHEDULED
    })
    .finally(() => {
      slot.inFlight = null
    })

  return slot.inFlight
}

// `needsSurface` gates the bus/tram half — see the comment on
// RAIL_FERRY_QUERY for why it's worth skipping. railTrips only ever comes from
// the rail half, so the merge takes it from there unconditionally.
async function fetchScheduledVehicles(needsSurface: boolean): Promise<ScheduledResult> {
  const [railFerry, busTram] = await Promise.all([
    loadScheduled(railFerrySlot, RAIL_FERRY_QUERY, 'rail/ferry'),
    needsSurface
      ? loadScheduled(busTramSlot, BUS_TRAM_QUERY, 'bus/tram')
      : Promise.resolve(EMPTY_SCHEDULED),
  ])
  if (busTram.vehicles.length === 0) return railFerry
  return {
    vehicles: [...railFerry.vehicles, ...busTram.vehicles],
    railTrips: railFerry.railTrips,
  }
}

// A single trip's stoptimes + shape, fetched on demand the first time a
// rider report needs to measure a schedule offset for it (see
// schedule-offset.ts) — deliberately NOT sourced from the bulk
// RAIL_FERRY_QUERY/BUS_TRAM_QUERY responses above, which discard this
// per-trip detail as soon as a position is computed. Keeping it around for
// every trip in those queries would reintroduce the exact 46MB-payload
// cost RAIL_FERRY_QUERY's own comment describes; a targeted single-trip
// query only ever runs for the handful of trips someone is actually
// riding.
const TRIP_SCHEDULE_QUERY = `
query TripSchedule($id: String!, $date: String!) {
  trip(id: $id) {
    pattern { patternGeometry { points } }
    stoptimesForDate(serviceDate: $date) {
      scheduledDeparture
      scheduledArrival
      stop { name lat lon }
    }
  }
}
`

interface TripSchedule {
  stoptimes: GqlStoptime[]
  shapeCoords: [number, number][] | null
}

interface TripScheduleEntry {
  schedule: TripSchedule
  fetchedAtMs: number
}

// Static for the whole service day once fetched, so this is cached far
// longer than anything above — refetching on every 7s vehicle poll (see
// POLL_INTERVALS.vehiclePositions) would turn a handful of ridden trips
// into a steady stream of avoidable OTP queries for data that never
// changes within a day.
const TRIP_SCHEDULE_CACHE_TTL = 6 * 60 * 60_000
const tripScheduleCache = new Map<string, TripScheduleEntry>()

async function fetchTripSchedule(tripId: string, serviceDate: string): Promise<TripSchedule | null> {
  const cached = tripScheduleCache.get(tripId)
  if (cached && Date.now() - cached.fetchedAtMs < TRIP_SCHEDULE_CACHE_TTL) return cached.schedule

  const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: TRIP_SCHEDULE_QUERY, variables: { id: tripId, date: serviceDate } }),
    cache: 'no-store',
    signal: AbortSignal.timeout(OTP_FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`OTP returned ${response.status}`)
  const data = await response.json()
  const trip = data?.data?.trip
  const stoptimes: GqlStoptime[] | undefined = trip?.stoptimesForDate
  if (!trip || !stoptimes || stoptimes.length < 2) return null

  const shapeCoords = trip.pattern?.patternGeometry?.points
    ? decodePolyline(trip.pattern.patternGeometry.points)
    : null

  const schedule: TripSchedule = { stoptimes, shapeCoords }
  tripScheduleCache.set(tripId, { schedule, fetchedAtMs: Date.now() })
  return schedule
}

interface OffsetEntry {
  offsetSec: number
  observedAtMs: number
}

// How far behind/ahead of schedule each actively-corrected trip currently
// is — see schedule-offset.ts. Kept separate from tripScheduleCache above
// (this one is small and short-lived in effect; that one is bigger and
// long-lived) so decaying an offset never requires re-fetching the
// schedule it was measured against.
const offsetCache = new Map<string, OffsetEntry>()

// Measures a fresh schedule offset for every trip currently carrying a live
// rider report, fetching that trip's schedule first if this is the first
// report seen for it. Best-effort: a trip whose schedule can't be fetched
// or resolved just keeps whatever offset (if any) is already cached from
// an earlier request.
async function refreshRiderOffsets(nowMs: number, nowSec: number, serviceDate: string): Promise<void> {
  const ids = reportedTripIds(nowMs)
  if (ids.length === 0) return

  await Promise.all(
    ids.map(async (tripId) => {
      const consensus = consensusFor(tripId, nowMs)
      if (!consensus) return
      const schedule = await fetchTripSchedule(tripId, serviceDate).catch(() => null)
      if (!schedule) return
      // consensus.reportedAt is epoch ms; convert to the same service-day
      // seconds clock the schedule itself is in, offset by how stale the
      // report already is (usually seconds, capped by REPORT_MAX_AGE_MS).
      const observedAtSec = nowSec - (nowMs - consensus.reportedAt) / 1000
      const offsetSec = measureOffsetSec(
        schedule.stoptimes,
        schedule.shapeCoords,
        consensus.lat,
        consensus.lng,
        observedAtSec,
      )
      if (offsetSec === null) return
      offsetCache.set(tripId, { offsetSec, observedAtMs: nowMs })
    }),
  )
}

// Repositions any estimated vehicle whose trip has a cached rider-derived
// offset, decaying that offset by how long ago it was measured (see
// decayOffsetSec) rather than snapping back to a pure schedule position the
// instant the rider report itself expires. Never touches a vehicle with a
// real GPS/live fix (`!v.estimated`): rider evidence corrects a schedule
// guess, it never second-guesses agency GPS.
function applyRiderOffsets(vehicles: VehiclePosition[], nowMs: number, nowSec: number): VehiclePosition[] {
  return vehicles.map((v) => {
    if (!v.estimated) return v
    const offset = offsetCache.get(v.id)
    if (!offset) return v

    const ageSec = (nowMs - offset.observedAtMs) / 1000
    if (ageSec > OFFSET_MAX_AGE_SEC) {
      offsetCache.delete(v.id)
      return v
    }

    const decayed = decayOffsetSec(offset.offsetSec, ageSec)
    if (Math.abs(decayed) < OFFSET_NOISE_FLOOR_SEC) return v

    const scheduleEntry = tripScheduleCache.get(v.id)
    if (!scheduleEntry) return v
    const corrected = interpolatePosition(scheduleEntry.schedule.stoptimes, nowSec - decayed, scheduleEntry.schedule.shapeCoords)
    if (!corrected) return v

    return {
      ...v,
      lat: corrected.lat,
      lng: corrected.lng,
      heading: corrected.heading,
      riderReported: true,
      riderConfidence: consensusFor(v.id, nowMs) ? 'observed' as const : 'inferred' as const,
    }
  })
}

function parseScheduled(data: { data?: Record<string, GqlRoute[] | undefined> }, nowSec: number): ScheduledResult {
  // Elron's schedule sits in the graph twice, under two feeds (see
  // ELRON_AGENCY_GTFS_ID) — without scoping to one, every train is drawn
  // twice, two markers stacked on the same coordinate. Fall back to the
  // unfiltered list if that agency id ever stops matching (e.g. a future
  // graph rebuild renumbers it) rather than silently showing no trains.
  const railRoutes: GqlRoute[] = data.data?.rail || []
  const elronRoutes = railRoutes.filter((r) => r.agency?.gtfsId === ELRON_AGENCY_GTFS_ID)
  const scopedRail = elronRoutes.length > 0 ? elronRoutes : railRoutes

  const allRoutes: GqlRoute[] = [
    ...scopedRail,
    ...(data.data?.ferry || []),
    ...(data.data?.bus || []),
    ...(data.data?.tram || []),
  ]
  const vehicles: VehiclePosition[] = []
  const railTrips = new Map<string, RailTripInfo>()
  const seenTrips = new Set<string>()

  for (const route of allRoutes) {
    for (const pattern of route.patterns) {
      const shapeCoords = pattern.patternGeometry?.points
        ? decodePolyline(pattern.patternGeometry.points)
        : null

      const mode = mapOtpMode(route.mode)

      for (const trip of pattern.tripsForDate) {
        if (seenTrips.has(trip.gtfsId)) continue
        seenTrips.add(trip.gtfsId)

        // Indexed before the in-motion check below, so a train running well
        // outside its scheduled window still resolves to a line/destination
        // when its live position comes in.
        if (mode === 'train' && trip.stoptimes.length > 0) {
          railTrips.set(trip.gtfsId, {
            line: route.shortName,
            destination: trip.stoptimes[trip.stoptimes.length - 1].stop.name,
            shapeCoords,
          })
        }

        const pos = interpolatePosition(trip.stoptimes, nowSec, shapeCoords)
        if (!pos) continue

        vehicles.push({
          id: trip.gtfsId,
          mode,
          line: route.shortName,
          lat: pos.lat,
          lng: pos.lng,
          heading: pos.heading,
          destination: pos.destination,
          estimated: true,
        })
      }
    }
  }

  return { vehicles, railTrips }
}

// Elron's feed carries no bearing (confirmed absent on every entity), so read
// the direction of travel off the trip's own shape instead: the pattern
// geometry runs in the direction the train travels, so the tangent at the
// point nearest the train is its heading. Better than deriving one from
// successive polls — correct on the very first sighting, and unbothered by a
// train sitting still at a platform.
function headingFromShape(shapeCoords: [number, number][], lat: number, lng: number): number {
  const lats = shapeCoords.map((c) => c[1])
  const lons = shapeCoords.map((c) => c[0])
  const idx = findNearestPointIndex(lats, lons, lat, lng)
  const from = idx < lats.length - 1 ? idx : Math.max(0, idx - 1)
  const to = Math.min(from + 1, lats.length - 1)
  if (from === to) return 0
  return calcHeading(lats[from], lons[from], lats[to], lons[to])
}

// Elron's real-time trip ids join exactly onto OTP's own (see toOtpTripId), so
// unlike Tallinn's feed — whose vehicles carry only a line number and have to
// be scored against every candidate trip by position and heading — a train's
// trip is known outright, with no matching and no chance of a wrong guess.
function buildLiveTrains(
  elron: { tripId: string; lat: number; lng: number }[],
  railTrips: Map<string, RailTripInfo>,
): VehiclePosition[] {
  const trains: VehiclePosition[] = []
  for (const v of elron) {
    const info = railTrips.get(v.tripId)
    // A trip the graph doesn't know about (feed drift, or a train running a
    // trip from a service date the graph hasn't got) can't be labelled with a
    // line or destination — showing it as an unnamed dot is worse than
    // leaving the scheduled estimate in place.
    if (!info) continue
    trains.push({
      id: v.tripId,
      mode: 'train',
      line: info.line,
      lat: v.lat,
      lng: v.lng,
      heading: info.shapeCoords && info.shapeCoords.length > 1
        ? headingFromShape(info.shapeCoords, v.lat, v.lng)
        : 0,
      destination: info.destination,
    })
  }
  return trains
}

// ~30km radius for city filtering (in degrees, rough approximation)
const CITY_RADIUS_DEG = 0.3

function filterByCities(vehicles: VehiclePosition[], cityCoords: { lat: number; lng: number }[]): VehiclePosition[] {
  return vehicles.filter((v) =>
    cityCoords.some((city) => {
      const dlat = Math.abs(v.lat - city.lat)
      const dlng = Math.abs(v.lng - city.lng)
      return dlat < CITY_RADIUS_DEG && dlng < CITY_RADIUS_DEG
    }),
  )
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const modesParam = searchParams.get('modes')
  const modes = modesParam ? (modesParam.split(',') as TransportMode[]) : null

  // Parse cities param: "lat,lng;lat,lng;..."
  const citiesParam = searchParams.get('cities')
  const cityCoords: { lat: number; lng: number }[] = citiesParam
    ? citiesParam.split(';').map((pair) => {
        const [lat, lng] = pair.split(',').map(Number)
        return { lat, lng }
      }).filter((c) => !isNaN(c.lat) && !isNaN(c.lng))
    : []

  const includesTallinn = cityCoords.length === 0 || cityCoords.some(
    (c) => Math.abs(c.lat - 59.437) < 0.1 && Math.abs(c.lng - 24.754) < 0.1,
  )

  // Whether a scheduled bus/tram could actually survive to be displayed, and
  // so whether the expensive half of the schedule query is worth running at
  // all (see RAIL_FERRY_QUERY). Inside the Tallinn GPS area those estimates
  // are dropped in favour of the live feed, and filterByCities then drops
  // everything outside the selected cities — so with only Tallinn selected,
  // which is the default view, not one of them can reach the response. No
  // cities selected means no city filter at all, so they show nationwide.
  const needsSurfaceSchedule =
    cityCoords.length === 0 ||
    cityCoords.some(
      (c) =>
        !(Math.abs(c.lat - 59.437) < CITY_RADIUS_DEG && Math.abs(c.lng - 24.754) < CITY_RADIUS_DEG),
    )

  try {
    const now = Date.now()
    const nowSec = getServiceSeconds()
    const serviceDate = getServiceDate()

    // Tallinn's live GPS feed, Elron's live train feed, the nationwide OTP
    // schedule query, and refreshing any rider-reported trips' schedule
    // offsets are all independent of each other — fetching them one after
    // another stacked every timeout into a single request.
    const [gpsVehicles, elron, scheduled] = await Promise.all([
      includesTallinn ? fetchTallinnGpsVehicles() : Promise.resolve<VehiclePosition[]>([]),
      // Non-critical, and an unofficial third-party mirror at that: trains
      // fall back to their scheduled estimate if it fails.
      fetchElronVehicles().catch(() => []),
      // Non-critical: continue with GPS-only vehicles if this fails.
      fetchScheduledVehicles(needsSurfaceSchedule).catch(() => EMPTY_SCHEDULED),
      // Non-critical: on failure, applyRiderOffsets below just keeps
      // whichever offsets (if any) are already cached from an earlier
      // request instead of blocking the whole response on it.
      refreshRiderOffsets(now, nowSec, serviceDate).catch(() => undefined),
    ])

    const liveTrains = buildLiveTrains(elron, scheduled.railTrips)
    // A train with a live position must not also appear as its own
    // schedule-interpolated ghost — same trip, same id, two markers, one of
    // them wrong. The live one wins; the estimate only covers trains the feed
    // isn't currently reporting.
    const liveTrainTripIds = new Set(liveTrains.map((t) => t.id))

    // Merge: use live GPS for Tallinn bus/tram and Elron trains, scheduled for
    // everything else. Only exclude scheduled bus/tram that overlap with
    // Tallinn's live GPS area.
    let vehicles: VehiclePosition[]
    if (includesTallinn) {
      const isTallinnArea = (v: VehiclePosition) =>
        Math.abs(v.lat - 59.437) < CITY_RADIUS_DEG && Math.abs(v.lng - 24.754) < CITY_RADIUS_DEG
      const scheduledFiltered = scheduled.vehicles.filter(
        (v) =>
          !liveTrainTripIds.has(v.id) &&
          (!isTallinnArea(v) || v.mode === 'train' || v.mode === 'ferry'),
      )
      vehicles = [...gpsVehicles, ...liveTrains, ...scheduledFiltered]
    } else {
      vehicles = [
        ...liveTrains,
        ...scheduled.vehicles.filter((v) => !liveTrainTripIds.has(v.id)),
      ]
    }

    // Overlay crowdsourced evidence (rider-reports.ts + schedule-offset.ts)
    // onto whichever vehicles above are pure schedule guesses — never onto
    // one already backed by agency GPS (gpsVehicles/liveTrains never carry
    // `estimated: true`). This is the only live signal that reaches a bus
    // outside Tallinn and Elron at all — see README's "no Estonian city
    // other than Tallinn" limit — which is exactly the set of vehicles left
    // as `estimated: true` here. Unlike overlaying a report's raw position
    // directly, this repositions along the schedule by a measured offset
    // that decays gracefully rather than snapping back to "on time" the
    // instant the freshest report expires (see applyRiderOffsets).
    vehicles = applyRiderOffsets(vehicles, now, nowSec)

    // Filter by city locations (trains/ferries bypass — they're intercity)
    if (cityCoords.length > 0) {
      const intercity = vehicles.filter((v) => v.mode === 'train' || v.mode === 'ferry')
      const local = vehicles.filter((v) => v.mode !== 'train' && v.mode !== 'ferry')
      vehicles = [...filterByCities(local, cityCoords), ...intercity]
    }

    if (modes) {
      vehicles = vehicles.filter((v) => modes.includes(v.mode))
    }

    return NextResponse.json({ vehicles, timestamp: now, availability: 'live' })
  } catch (error) {
    console.error('Failed to fetch vehicle positions:', error)
    if (gpsCache && includesTallinn) {
      return NextResponse.json({
        vehicles: gpsCache.data,
        timestamp: gpsCache.timestamp,
        availability: 'stale',
      })
    }
    return NextResponse.json({ error: 'Failed to fetch vehicle positions' }, { status: 502 })
  }
}
