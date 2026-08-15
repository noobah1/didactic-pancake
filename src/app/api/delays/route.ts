import { NextResponse } from 'next/server'
import { GPS_FEED_URL, OTP_BASE_URL, TALLINN_TRANSPORT_AGENCY_GTFS_ID } from '@/lib/constants'
import { parseGpsFeed } from '@/lib/parse-gps'
import { findBestTrip, matchVehicleToTrip, distanceMeters } from '@/lib/delay'
import { getServiceDate, getServiceSeconds } from '@/lib/service-date'
import { VehiclePosition } from '@/lib/types'

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

// Only bus/tram/trolleybus/nightbus have any live GPS signal (Tallinn feed) —
// train and ferry never enter this endpoint, which alone guarantees they're
// never shown as "on time" anywhere that consumes this data.
type GpsMode = 'bus' | 'tram' | 'trolleybus' | 'nightbus'

// Tallinn's unified GTFS feed tags trolleybus/night-bus routes with GTFS mode
// BUS (no TROLLEYBUS route_type exists in the data, and night buses aren't a
// distinct GTFS route_type at all — just a night-only service calendar) —
// same mapping trip-stops/route.ts already uses. So the bulk schedule query
// below only needs BUS + TRAM.
const VEHICLE_MODE_TO_OTP: Record<GpsMode, string> = {
  bus: 'BUS',
  tram: 'TRAM',
  trolleybus: 'BUS',
  nightbus: 'BUS',
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
  })

  if (!response.ok) return scheduleCache?.data || []

  const data = await response.json()
  if (data.errors?.length) return scheduleCache?.data || []

  const allRoutes: GqlRoute[] = [...(data.data?.bus || []), ...(data.data?.tram || [])]
  // Every vehicle this endpoint matches comes from Tallinn's live GPS feed —
  // scope candidates to Tallinn's own operator so a same-numbered route from
  // an unrelated town never wins the match (see TALLINN_TRANSPORT_AGENCY_GTFS_ID).
  // Fall back to the unfiltered list if the agency id ever stops matching
  // anything (e.g. a future graph rebuild renumbers it) instead of silently
  // returning zero candidates for every route.
  const tallinnRoutes = allRoutes.filter((r) => r.agency?.gtfsId === TALLINN_TRANSPORT_AGENCY_GTFS_ID)
  const routes = tallinnRoutes.length > 0 ? tallinnRoutes : allRoutes
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

async function computeDelays(): Promise<DelaysResponse> {
  const now = Date.now()

  if (!gpsCache || now - gpsCache.timestamp > GPS_CACHE_TTL) {
    const response = await fetch(GPS_FEED_URL, { cache: 'no-store' })
    if (!response.ok) throw new Error(`GPS feed returned ${response.status}`)
    const text = await response.text()
    gpsCache = { data: parseGpsFeed(text), timestamp: now }
  }
  const gpsVehicles = gpsCache.data.filter(
    (v): v is VehiclePosition & { mode: GpsMode } =>
      v.mode === 'bus' || v.mode === 'tram' || v.mode === 'trolleybus' || v.mode === 'nightbus',
  )

  const routes = await fetchScheduleData()
  const tripsByLine = buildTripsByLine(routes)
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

    const otpMode = VEHICLE_MODE_TO_OTP[gv.mode]
    // Tram route shortNames carry a T-prefix (e.g. "T2") since the GTFS rebuild
    const routeName = gv.mode === 'tram' && !/^T/i.test(gv.line) ? `T${gv.line}` : gv.line
    const candidates = tripsByLine[`${otpMode}:${routeName}`]
    if (!candidates || candidates.length === 0) continue

    const preferredTripId = vehicleTripMemory.get(gv.id) ?? null
    const bestTrip = findBestTrip(candidates, nowSec, gv.destination, gv.lat, gv.lng, gv.heading, preferredTripId)
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
    vehicles.push({
      vehicleId: gv.id,
      tripId: bestTrip.gtfsId,
      line: gv.line,
      mode: gv.mode,
      destination: gv.destination,
      delaySeconds: match.delaySeconds,
      lat: gv.lat,
      lng: gv.lng,
      heading: gv.heading,
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

  return { vehicles: reliableVehicles, timestamp: now }
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
    if (resultCache) {
      return NextResponse.json({ ...resultCache.data, stale: true })
    }
    return NextResponse.json({ vehicles: [], timestamp: Date.now() })
  }
}
