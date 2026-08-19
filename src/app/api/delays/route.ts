import { NextResponse } from 'next/server'
import {
  GPS_FEED_URL,
  OTP_BASE_URL,
  OTP_FETCH_TIMEOUT_MS,
  GPS_FEED_TIMEOUT_MS,
  TALLINN_TRANSPORT_AGENCY_GTFS_ID,
  ELRON_AGENCY_GTFS_ID,
} from '@/lib/constants'
import { parseGpsFeed } from '@/lib/parse-gps'
import { fetchElronVehicles } from '@/lib/elron'
import { findBestTrip, matchVehicleToTrip, distanceMeters, calcHeading } from '@/lib/delay'
import { getServiceDate, getServiceSeconds } from '@/lib/service-date'
import { VehiclePosition } from '@/lib/types'
import { Availability, STALE_MAX_AGE_MS } from '@/lib/feed-status'

const GPS_CACHE_TTL = 5_000
const SCHEDULE_CACHE_TTL = 10 * 60_000 // static schedule doesn't change intraday
// Deliberately shorter than the client's own 20s poll interval (see
// POLL_INTERVALS.delays), not equal to it. Equal-and-unsynchronized meant a
// client poll could land just before each server-side refresh and end up
// looking at a result computed nearly a full poll cycle earlier — up to
// ~40s stale end-to-end (this cache's age plus the wait for the client's
// next poll) on every single request, not just as an occasional edge case.
// A vehicle that's actively getting later shows that lag directly as "the
// delay board says 3 minutes, but it's clearly been 4 by now." Short
// enough that, by the time the client's next 20s poll arrives, this cache
// has almost certainly refreshed at least once — long enough to still
// absorb bursts of near-simultaneous requests without recomputing for each.
const RESULT_CACHE_TTL = 8_000
// Real bunched buses on the same trip sit within meters of each other. Beyond
// this, two vehicles matched to the same trip are not the same bus — the
// match is unreliable for both, not just one of them.
const SAME_TRIP_MAX_SPREAD_M = 500

// bus/tram/trolleybus/nightbus have live GPS via Tallinn's own feed; train via
// Elron's (unofficial, see ELRON_VEHICLE_POSITIONS_URL in constants). Ferry never enters
// this endpoint — no real-time source exists for it — which alone guarantees
// it's never shown as "on time" anywhere that consumes this data.
type GpsMode = 'bus' | 'tram' | 'trolleybus' | 'nightbus' | 'train'

// Tallinn's unified GTFS feed tags trolleybus/night-bus routes with GTFS mode
// BUS (no TROLLEYBUS route_type exists in the data, and night buses aren't a
// distinct GTFS route_type at all — just a night-only service calendar) —
// same mapping trip-stops/route.ts already uses. So the bulk schedule query
// below only needs BUS + TRAM (+ RAIL, for Elron).
const VEHICLE_MODE_TO_OTP: Record<GpsMode, string> = {
  bus: 'BUS',
  tram: 'TRAM',
  trolleybus: 'BUS',
  nightbus: 'BUS',
  train: 'RAIL',
}

const SCHEDULE_QUERY = `
query BusTramTrips($date: String!) {
  bus: routes(transportModes: [BUS]) {
    shortName
    mode
    agency { gtfsId }
    patterns {
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
    agency { gtfsId }
    patterns {
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
  rail: routes(transportModes: [RAIL]) {
    shortName
    mode
    agency { gtfsId }
    patterns {
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
  tripsForDate: GqlTrip[]
}

interface GqlRoute {
  shortName: string
  mode: string
  agency?: { gtfsId: string } | null
  patterns: GqlPattern[]
}

export interface DelayedVehicle {
  vehicleId: string
  tripId: string
  line: string
  mode: GpsMode
  destination: string
  delaySeconds: number
  lat: number
  lng: number
  heading: number
}

interface DelaysResponse {
  vehicles: DelayedVehicle[]
  timestamp: number
  availability?: Availability
}

let gpsCache: { data: VehiclePosition[]; timestamp: number } | null = null
let scheduleCache: { data: GqlRoute[]; timestamp: number } | null = null
let resultCache: { data: DelaysResponse; timestamp: number } | null = null
// Which trip each vehicle was matched to last cycle, so findBestTrip can
// break same-route ambiguity in favor of continuity (see
// TRIP_CONTINUITY_BONUS). Rebuilt from scratch each computeDelays() run
// (see bottom of that function) so a vehicle that drops out of the GPS feed
// even briefly loses its "sticky" match rather than anchoring forever to a
// trip it may no longer be running.
let vehicleTripMemory = new Map<string, string>()
// Recent positions per vehicle, oldest first, used to detect a vehicle
// that's genuinely parked (see the stationary check below) rather than reset
// every cycle like vehicleTripMemory — movement can only be measured across
// multiple polls. Self-cleaning: a vehicle absent from the current GPS poll
// is simply never carried into nextPositionHistory (see bottom of
// computeDelays), so a vehicle that drops off the feed doesn't accumulate
// history forever.
let vehiclePositionHistory = new Map<string, { lat: number; lng: number; t: number }[]>()
// How long a vehicle needs to stay within STATIONARY_RADIUS_M of its own
// recent positions to count as parked, not just paused at a light or
// briefly boxed in by traffic — long enough that normal stop-and-go
// doesn't false-positive. Confirmed live: a real depot-parked bus still
// occasionally jitters past a tight (60m) radius from any single reference
// point — multipath off other parked buses/yard buildings — so the check
// below uses the point cloud's overall spread rather than each sample
// against just the latest one, and the radius has room for that jitter
// while still being far tighter than a bus could travel, even crawling in
// heavy traffic, over a full three minutes.
const STATIONARY_WINDOW_MS = 3 * 60_000
const STATIONARY_RADIUS_M = 120

async function fetchScheduleData(): Promise<GqlRoute[]> {
  const now = Date.now()
  if (scheduleCache && now - scheduleCache.timestamp < SCHEDULE_CACHE_TTL) {
    return scheduleCache.data
  }

  const date = getServiceDate()
  const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SCHEDULE_QUERY, variables: { date } }),
    cache: 'no-store',
    signal: AbortSignal.timeout(OTP_FETCH_TIMEOUT_MS),
  })

  if (!response.ok) return scheduleCache?.data || []

  const data = await response.json()
  if (data.errors?.length) return scheduleCache?.data || []

  const busTramRoutes: GqlRoute[] = [...(data.data?.bus || []), ...(data.data?.tram || [])]
  // Every bus/tram vehicle this endpoint matches comes from Tallinn's live GPS
  // feed — scope candidates to Tallinn's own operator so a same-numbered
  // route from an unrelated town never wins the match (see
  // TALLINN_TRANSPORT_AGENCY_GTFS_ID). Fall back to the unfiltered list if
  // the agency id ever stops matching anything (e.g. a future graph rebuild
  // renumbers it) instead of silently returning zero candidates for every
  // route.
  const tallinnRoutes = busTramRoutes.filter((r) => r.agency?.gtfsId === TALLINN_TRANSPORT_AGENCY_GTFS_ID)
  const scopedBusTram = tallinnRoutes.length > 0 ? tallinnRoutes : busTramRoutes

  const railRoutes: GqlRoute[] = data.data?.rail || []
  // Same scoping, for Elron (see ELRON_AGENCY_GTFS_ID on why this specific
  // gtfsId — the fresher of two duplicate copies of Elron's schedule in the
  // graph — was chosen over the other).
  const elronRoutes = railRoutes.filter((r) => r.agency?.gtfsId === ELRON_AGENCY_GTFS_ID)
  const scopedRail = elronRoutes.length > 0 ? elronRoutes : railRoutes

  const routes = [...scopedBusTram, ...scopedRail]
  scheduleCache = { data: routes, timestamp: now }
  return routes
}

// Group all trips by "MODE:shortName" for O(1) lookup per GPS vehicle's line
function buildTripsByLine(routes: GqlRoute[]): Record<string, GqlTrip[]> {
  const map: Record<string, GqlTrip[]> = {}
  for (const route of routes) {
    const key = `${route.mode}:${route.shortName}`
    const trips = map[key] || (map[key] = [])
    for (const pattern of route.patterns) {
      trips.push(...pattern.tripsForDate)
    }
  }
  return map
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

// Exported for the push-notification checker (src/lib/push-checker.ts),
// which calls this directly rather than round-tripping through its own
// GET handler — same computation, just invoked server-internally instead
// of over HTTP.
export async function computeDelays(): Promise<DelaysResponse> {
  const now = Date.now()

  // These three are independent of each other (two unrelated live-position
  // feeds and a static schedule query) — fetching them one after another
  // stacked their timeouts (up to 5s + 5s + 8s = 18s worst case) into a
  // single request's latency for no reason. allSettled (rather than all) so
  // a failure names which upstream actually died instead of an opaque
  // rejection — Elron already degrades internally on its own failure (see
  // fetchElronVehicles), but the schedule query and Tallinn's GPS feed are
  // both load-bearing: a delay is GPS measured against schedule, so losing
  // either still means no vehicles here, just with a clearer reason logged.
  const [gpsResult, elronResult, scheduleResult] = await Promise.allSettled([
    fetchTallinnGpsVehicles(),
    fetchElronVehicles(),
    fetchScheduleData(),
  ])
  if (gpsResult.status === 'rejected') {
    throw new Error(`Tallinn GPS feed unavailable: ${gpsResult.reason}`)
  }
  if (scheduleResult.status === 'rejected') {
    throw new Error(`OTP schedule unavailable: ${scheduleResult.reason}`)
  }
  const tallinnGps = gpsResult.value
  const elronVehicles = elronResult.status === 'fulfilled' ? elronResult.value : []
  const routes = scheduleResult.value
  const gpsVehicles: (VehiclePosition & { mode: GpsMode })[] = [
    ...tallinnGps.filter(
      (v): v is VehiclePosition & { mode: GpsMode } =>
        v.mode === 'bus' || v.mode === 'tram' || v.mode === 'trolleybus' || v.mode === 'nightbus',
    ),
    // line/destination/heading are unknown for Elron — resolved from the
    // trip the vehicle's own id names (see the mode === 'train' branch in the
    // loop). The id is the OTP trip gtfsId, which is also what /api/vehicles
    // keys its live train markers by, so the delay board and the map agree on
    // what is the same train.
    ...elronVehicles.map((v) => ({
      id: v.tripId,
      mode: 'train' as const,
      line: '',
      destination: '',
      heading: 0,
      lat: v.lat,
      lng: v.lng,
    })),
  ]

  const tripsByLine = buildTripsByLine(routes)
  // Elron's live feed names the trip each train is running outright, and those
  // ids join exactly onto OTP's own (see toOtpTripId) — so trains skip the
  // position/heading scoring every other mode needs entirely, and can't be
  // matched to the wrong trip at all. The pooled scoring below is only a
  // fallback for a trip the graph doesn't have (feed drift, or a train still
  // running yesterday's service past midnight).
  const railTripById = new Map<string, GqlTrip>()
  const railTripPool: GqlTrip[] = []
  const railTripLine = new Map<string, string>()
  for (const [key, trips] of Object.entries(tripsByLine)) {
    if (!key.startsWith('RAIL:')) continue
    const line = key.slice('RAIL:'.length)
    for (const trip of trips) {
      railTripById.set(trip.gtfsId, trip)
      railTripPool.push(trip)
      railTripLine.set(trip.gtfsId, line)
    }
  }
  const nowSec = getServiceSeconds()

  const vehicles: DelayedVehicle[] = []
  const nextTripMemory = new Map<string, string>()
  const nextPositionHistory = new Map<string, { lat: number; lng: number; t: number }[]>()
  for (const gv of gpsVehicles) {
    // Carry this vehicle's position history forward (see the stationary
    // check below) regardless of whether it ends up matched to a trip this
    // cycle — a vehicle briefly falling out of line/mode lookup shouldn't
    // reset the clock on how long it's been sitting still.
    const history = [...(vehiclePositionHistory.get(gv.id) || []), { lat: gv.lat, lng: gv.lng, t: now }]
      .filter((p) => now - p.t <= STATIONARY_WINDOW_MS)
    nextPositionHistory.set(gv.id, history)

    const isTrain = gv.mode === 'train'
    const otpMode = VEHICLE_MODE_TO_OTP[gv.mode]
    // Tram route shortNames carry a T-prefix (e.g. "T2") since the GTFS rebuild
    const routeName = gv.mode === 'tram' && !/^T/i.test(gv.line) ? `T${gv.line}` : gv.line

    // A train's own id is its trip — take it directly rather than re-deriving
    // it from position and time, which both drops trains no candidate scores
    // confidently enough (leaving them off the board entirely) and, when a
    // wrong trip does win, reports a delay for a journey the train isn't on.
    const knownTrip = isTrain ? railTripById.get(gv.id) : undefined

    let bestTrip: GqlTrip | null = knownTrip ?? null
    if (!bestTrip) {
      const candidates = isTrain ? railTripPool : tripsByLine[`${otpMode}:${routeName}`]
      if (!candidates || candidates.length === 0) continue

      const preferredTripId = vehicleTripMemory.get(gv.id) ?? null
      bestTrip = findBestTrip(
        candidates,
        nowSec,
        isTrain ? null : gv.destination,
        gv.lat,
        gv.lng,
        isTrain ? null : gv.heading,
        preferredTripId,
      )
    }
    if (!bestTrip) continue
    nextTripMemory.set(gv.id, bestTrip.gtfsId)

    const match = matchVehicleToTrip(bestTrip.stoptimes, gv.lat, gv.lng, nowSec)

    // A vehicle parked at its trip's own final *stop* has already finished
    // that trip — it's sitting at a terminus, possibly done for the night,
    // not "running 0 seconds late" in any sense a rider cares about. But
    // real depot yards are frequently nowhere near the route's official
    // GTFS-recorded last stop (confirmed live: five different routes'
    // buses parked together at a shared yard, each still "matched" to a
    // trip whose own recorded endpoint sat up to 4km away) — no fixed
    // radius from that one point can catch every operator's actual yard
    // location. So alongside the stop-proximity check, also treat a
    // vehicle as off-duty once its trip's own schedule says it should
    // already be finished AND it hasn't materially moved in
    // STATIONARY_WINDOW_MS — a real depot-parked bus doesn't move at all,
    // where even a bus stuck in heavy traffic still creeps forward more
    // than STATIONARY_RADIUS_M over a full three minutes. Gated on being
    // past the trip's scheduled finish so a bus stopped at a red light or
    // held at a mid-route stop earlier in a trip is never caught by this.
    const lastStoptime = bestTrip.stoptimes[bestTrip.stoptimes.length - 1]
    const scheduledEnd = lastStoptime.scheduledArrival || lastStoptime.scheduledDeparture
    const pastScheduledEnd = nowSec > scheduledEnd
    let maxSpread = 0
    for (let i = 0; i < history.length; i++) {
      for (let j = i + 1; j < history.length; j++) {
        maxSpread = Math.max(maxSpread, distanceMeters(history[i].lat, history[i].lng, history[j].lat, history[j].lng))
      }
    }
    const stationary =
      history.length >= 2 && now - history[0].t >= STATIONARY_WINDOW_MS && maxSpread < STATIONARY_RADIUS_M

    // Showing it with delaySeconds: 0 (or, once far enough past
    // MAX_TRIP_OVERRUN_SEC's matching window, a bogus large delay) is
    // exactly the depot bug this matcher exists to prevent. Drop it from
    // the board entirely instead — it reappears once it actually pulls out
    // for a new trip and stops being stationary.
    if (match.nearFinalStop || (pastScheduledEnd && stationary)) continue
    // Elron gives no line/destination up front — resolve them from the
    // matched trip itself now that we have one.
    const line = isTrain ? railTripLine.get(bestTrip.gtfsId) ?? gv.line : gv.line
    const destination = isTrain
      ? bestTrip.stoptimes[bestTrip.stoptimes.length - 1].stop.name
      : gv.destination
    // Elron's feed carries no bearing either (see src/lib/elron.ts), but the
    // match above already places the train on a specific leg of its trip —
    // that leg's own direction is the heading. Left at the feed's 0 it would
    // read as "due north" to anything consuming this, including
    // findVehicleForLeg's heading gate.
    const nextStop = bestTrip.stoptimes[match.afterStopIndex + 1]
    const heading =
      isTrain && nextStop
        ? calcHeading(
            bestTrip.stoptimes[match.afterStopIndex].stop.lat,
            bestTrip.stoptimes[match.afterStopIndex].stop.lon,
            nextStop.stop.lat,
            nextStop.stop.lon,
          )
        : gv.heading
    vehicles.push({
      vehicleId: gv.id,
      tripId: bestTrip.gtfsId,
      line,
      mode: gv.mode,
      destination,
      delaySeconds: match.delaySeconds,
      lat: gv.lat,
      lng: gv.lng,
      heading,
    })
  }
  vehicleTripMemory = nextTripMemory
  vehiclePositionHistory = nextPositionHistory

  // When many vehicles on a route are genuinely delayed, real GPS position
  // stops correlating well with the static schedule — the exact condition
  // that makes trip identification hardest. Two real vehicles kilometers
  // apart can each independently "win" the same trip match. Rather than
  // arbitrarily trust one, drop every vehicle sharing a trip whose matched
  // vehicles are too far apart to plausibly be the same bus.
  //
  // But a single scheduled trip only ever has one real bus running it — even
  // when two different vehicles land within SAME_TRIP_MAX_SPREAD_M of each
  // other (e.g. a frequent line whose next trip starts just minutes after
  // the previous one, so findBestTrip can't cleanly separate two real,
  // independently-moving buses), showing both as separate rows in the delay
  // board is a visible "duplicate" — same line, same destination, listed
  // twice. Collapse each shared trip down to one vehicle: the one whose
  // delay is closest to zero, since a genuine match to a trip tends to track
  // that trip's own schedule more closely than an incidental/borrowed one.
  const bySharedTrip = new Map<string, DelayedVehicle[]>()
  for (const v of vehicles) {
    const group = bySharedTrip.get(v.tripId) || []
    group.push(v)
    bySharedTrip.set(v.tripId, group)
  }
  const reliableVehicles: DelayedVehicle[] = []
  for (const group of bySharedTrip.values()) {
    if (group.length === 1) {
      reliableVehicles.push(group[0])
      continue
    }
    let maxSpread = 0
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        maxSpread = Math.max(maxSpread, distanceMeters(group[i].lat, group[i].lng, group[j].lat, group[j].lng))
      }
    }
    if (maxSpread > SAME_TRIP_MAX_SPREAD_M) continue // contradictory matches — neither can be trusted
    reliableVehicles.push(
      group.reduce((best, v) => (Math.abs(v.delaySeconds) < Math.abs(best.delaySeconds) ? v : best)),
    )
  }

  return { vehicles: reliableVehicles, timestamp: now, availability: 'live' }
}

export async function GET() {
  try {
    const now = Date.now()
    if (resultCache && now - resultCache.timestamp < RESULT_CACHE_TTL) {
      return NextResponse.json(resultCache.data)
    }

    const result = await computeDelays()
    resultCache = { data: result, timestamp: now }
    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to compute delays:', error)
    // A warm cache is only worth labeling "stale" (still shown, just aged)
    // within STALE_MAX_AGE_MS — past that, presenting it as merely "a bit
    // behind" would itself be misleading. This is what the 45-hour OTP
    // outage would have hit had resultCache been warm at the time: without
    // this cap, the catch branch below served whatever it had forever,
    // with no re-check against RESULT_CACHE_TTL or any other ceiling.
    if (resultCache && Date.now() - resultCache.timestamp < STALE_MAX_AGE_MS) {
      return NextResponse.json(
        { ...resultCache.data, availability: 'stale' },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return NextResponse.json(
      { vehicles: [], timestamp: Date.now(), availability: 'unavailable' },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
