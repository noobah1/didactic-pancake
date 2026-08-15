import { TripStopInfo } from './types'

// Grace period before marking a stop late/passed (matches TimetablePanel's own buffer)
export const LATE_BUFFER_SEC = 59
// Minimum delay before the live "your bus is running late" banner fires
export const LIVE_BANNER_THRESHOLD_SEC = 60
// Minimum delay for a line to appear in the citywide delays overview — higher than
// the banner threshold since an overview aggregates the whole fleet at once; at 60s,
// ordinary GPS jitter/dwell-time variance would put a large fraction of all lines in
// the list constantly, defeating the "what's actually wrong right now" purpose.
export const OVERVIEW_THRESHOLD_SEC = 180
// How far ahead/behind "now" a route-planner leg can be and still attempt a live
// delay match — legs further out have no vehicle running yet to match against.
export const ROUTE_PLAN_MATCH_WINDOW_SEC = 20 * 60
// Minimum score gap (distance-meters + time-seconds*5 + heading-degrees*2)
// between the best and second-best candidate trip for a GPS-vehicle-to-trip
// match to be trusted. Empirically, a correct match wins by thousands of
// points; a coin-flip caused by a destination-naming mismatch wins by only
// ~100-150. 500 sits well between the two.
export const MIN_MATCH_CONFIDENCE_MARGIN = 500
// Absolute floor on how far a matched trip's route can be from the vehicle's
// real GPS position. Same-named routes recur nationwide (e.g. route "32"
// exists in Tallinn, Rakvere, Kuressaare...); without this, a Tallinn vehicle
// can end up "matched" to a route on the other side of the country whenever
// destination-text filtering fails to narrow the field.
export const MAX_MATCH_DISTANCE_M = 800
// How far past a trip's scheduled final arrival it's still considered
// "active" for matching. This has to be generous, not a rounding buffer —
// LATE_BUFFER_SEC (59s) is for classifying a stop passed/current on a trip
// already known to be the right one; this instead decides whether a trip is
// even a candidate at all. A bus running badly late is exactly the vehicle
// this whole feature exists to surface, and it's still visibly running its
// trip right up until it actually reaches the last stop — excluding it the
// moment it's a minute past its *scheduled* finish made the worst delays
// vanish from the list entirely (or, worse, get matched to a later trip on
// the same route that hadn't started yet) right when they mattered most.
// Can afford to be generous now that trip continuity (TRIP_CONTINUITY_BONUS
// below) is what actually keeps a badly late vehicle locked onto its own
// trip when the next scheduled trip on the same route has also started —
// this window just decides which trips are even in the running.
export const MAX_TRIP_OVERRUN_SEC = 30 * 60
// Score bonus (see tripPositionScore's scale) given to whichever candidate
// trip matches the vehicle's previous poll's match. A single GPS snapshot
// genuinely cannot tell "the bus I'm already tracking is just very late"
// apart from "a different, coincidentally-better-timed trip on the same
// route" — a late-running bus's own timing gap against its real trip can
// easily score worse than its numeric closeness to a trip that hasn't
// started yet, and trips on the same route/pattern share identical stop
// geometry, so position alone never breaks that tie either. Deliberately set
// high enough that ordinary schedule-timing competition from a same-route
// trip essentially never outscores it — because it structurally can't
// distinguish "still late on the right trip" from "already on the next one"
// on a single snapshot, and staying correctly matched to a genuinely-still-
// running late bus is the case this whole feature is for. The real release
// valve is MAX_TRIP_OVERRUN_SEC: once the previous trip ages out of its own
// active window, it simply isn't a candidate to be continuity-preferred
// anymore, regardless of score.
export const TRIP_CONTINUITY_BONUS = 3000

export interface DelayStop {
  name: string
  lat: number
  lon: number
  gtfsId?: string
}

export interface DelayStoptime {
  scheduledArrival: number
  scheduledDeparture: number
  stop: DelayStop
}

export interface DelayTrip {
  stoptimes: DelayStoptime[]
  // Optional so callers that never need trip continuity (or don't have a
  // stable trip id handy) aren't forced to supply one.
  gtfsId?: string
}

// Haversine distance in meters between two points
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Project point onto line segment, return fraction (0-1) along segment
export function projectOntoSegment(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): { fraction: number; dist: number } {
  const dx = bLon - aLon
  const dy = bLat - aLat
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return { fraction: 0, dist: distanceMeters(pLat, pLon, aLat, aLon) }
  let t = ((pLon - aLon) * dx + (pLat - aLat) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const projLat = aLat + t * dy
  const projLon = aLon + t * dx
  return { fraction: t, dist: distanceMeters(pLat, pLon, projLat, projLon) }
}

// Calculate heading (degrees) from point A to point B
export function calcHeading(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLng = ((lon2 - lon1) * Math.PI) / 180
  const rLat1 = (lat1 * Math.PI) / 180
  const rLat2 = (lat2 * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(rLat2)
  const x = Math.cos(rLat1) * Math.sin(rLat2) - Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

// Angular difference between two headings (0-180)
export function headingDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

// Score a trip by how close the vehicle's GPS position is to where the trip should be right now
export interface TripPositionScore {
  score: number
  bestDist: number
}

export function tripPositionScore(
  trip: DelayTrip,
  nowSec: number,
  vLat: number,
  vLng: number,
  vHeading?: number | null,
): TripPositionScore {
  let bestDist = Infinity
  let bestTimeDiff = Infinity
  let bestHeadingDiff = 0
  for (let i = 0; i < trip.stoptimes.length - 1; i++) {
    const a = trip.stoptimes[i].stop
    const b = trip.stoptimes[i + 1].stop
    const proj = projectOntoSegment(vLat, vLng, a.lat, a.lon, b.lat, b.lon)
    if (proj.dist < bestDist) {
      bestDist = proj.dist
      const segStart = trip.stoptimes[i].scheduledDeparture
      const segEnd = trip.stoptimes[i + 1].scheduledArrival
      const interpolatedTime = segStart + proj.fraction * (segEnd - segStart)
      bestTimeDiff = Math.abs(nowSec - interpolatedTime)
      // Local segment heading, not the trip's start-to-end straight-line
      // bearing — a winding/looping route's overall bearing is meaningless
      // for any specific point along it, and using it as a hard pre-filter
      // (as this used to) can wrongly exclude the correct trip entirely.
      // Folded into the score as a soft nudge instead so distance/time still
      // decide close calls correctly even when this one signal is noisy.
      bestHeadingDiff = vHeading != null ? headingDiff(vHeading, calcHeading(a.lat, a.lon, b.lat, b.lon)) : 0
    }
  }
  // Distance in meters + a heavy per-second time penalty + a heading-mismatch
  // penalty, so trips sharing identical geometry are disambiguated by
  // schedule instead of tying at 0.
  return { score: bestDist + bestTimeDiff * 5 + bestHeadingDiff * 2, bestDist }
}

// Find the best matching trip from a route's trips for a GPS vehicle.
// preferredTripId, when given, is the trip this same vehicle was matched to
// on the previous poll — see TRIP_CONTINUITY_BONUS.
export function findBestTrip<T extends DelayTrip>(
  trips: T[],
  nowSec: number,
  destination?: string | null,
  vehicleLat?: number | null,
  vehicleLng?: number | null,
  vehicleHeading?: number | null,
  preferredTripId?: string | null,
): T | null {
  // Filter to trips currently running (between first departure and last
  // arrival, with generous tolerance on the tail end for genuinely late
  // vehicles — see MAX_TRIP_OVERRUN_SEC).
  const activeTrips = trips.filter((t) => {
    if (t.stoptimes.length < 2) return false
    const firstDep = t.stoptimes[0].scheduledDeparture
    const lastArr = t.stoptimes[t.stoptimes.length - 1].scheduledArrival
      || t.stoptimes[t.stoptimes.length - 1].scheduledDeparture
    return nowSec >= firstDep && nowSec <= lastArr + MAX_TRIP_OVERRUN_SEC
  })

  if (activeTrips.length === 0) return null

  // Step 1: Filter by destination to get the correct direction
  let directionTrips = activeTrips
  if (destination) {
    const destLower = destination.toLowerCase().trim()
    const matched = activeTrips.filter((t) => {
      const lastStop = t.stoptimes[t.stoptimes.length - 1].stop.name.toLowerCase()
      return lastStop === destLower || lastStop.includes(destLower) || destLower.includes(lastStop)
    })
    if (matched.length > 0) directionTrips = matched
  }

  // Step 2: Among direction-matched trips, use GPS position (+ heading as a
  // soft tiebreaker, folded into the score) to pick the best one. If
  // destination text didn't narrow it down (common at big interchanges,
  // where the live feed's colloquial destination name and GTFS's precise
  // stop name for the same physical hub don't textually match at all — e.g.
  // "Viru keskus" vs "A. Laikmaa", ~48m apart), multiple unrelated trips can
  // score within noise of each other. Trust the pick only when it clearly
  // beats the runner-up; otherwise this is a coin flip, not a real match.
  if (vehicleLat != null && vehicleLng != null) {
    let bestTrip = directionTrips[0]
    let bestScore = Infinity
    let bestTripDist = Infinity
    let secondBestScore = Infinity
    for (const trip of directionTrips) {
      const { score: rawScore, bestDist } = tripPositionScore(trip, nowSec, vehicleLat, vehicleLng, vehicleHeading)
      const score = preferredTripId && trip.gtfsId === preferredTripId
        ? rawScore - TRIP_CONTINUITY_BONUS
        : rawScore
      if (score < bestScore) {
        secondBestScore = bestScore
        bestScore = score
        bestTrip = trip
        bestTripDist = bestDist
      } else if (score < secondBestScore) {
        secondBestScore = score
      }
    }
    // Absolute floor: if even the winner's route isn't physically near the
    // vehicle, this candidate pool didn't contain the real trip at all (e.g.
    // destination text matched nothing and the "best of a bad bunch" was some
    // unrelated route hundreds of km away) — no plausible match beats "none".
    if (bestTripDist > MAX_MATCH_DISTANCE_M) return null
    // Relative floor: if the top two are within noise of each other, this is
    // a coin flip (see comment above), not a real match.
    if (directionTrips.length > 1 && secondBestScore - bestScore < MIN_MATCH_CONFIDENCE_MARGIN) {
      return null
    }
    return bestTrip
  }

  // Step 3: No GPS — pick the trip closest to current time
  if (directionTrips.length === 1) return directionTrips[0]

  let bestTrip = directionTrips[0]
  let bestDiff = Infinity
  for (const trip of directionTrips) {
    const diff = Math.abs(nowSec - trip.stoptimes[0].scheduledDeparture)
    if (diff < bestDiff) {
      bestDiff = diff
      bestTrip = trip
    }
  }
  return bestTrip
}

export interface VehicleTripMatch {
  afterStopIndex: number
  fraction: number
  atStopIndex: number
  delaySeconds: number
}

// Core GPS-vs-schedule matching: where is the vehicle along the trip (as a
// segment index + fraction), and how many seconds behind schedule is it.
export function matchVehicleToTrip(
  stoptimes: DelayStoptime[],
  vLat: number,
  vLng: number,
  nowSec: number,
): VehicleTripMatch {
  // Use time as a hint but search wider — GPS position is the truth
  let timeSegIdx = -1
  for (let i = 0; i < stoptimes.length - 1; i++) {
    const dep = stoptimes[i].scheduledDeparture
    const nextArr = stoptimes[i + 1].scheduledArrival
    if (nowSec >= dep && nowSec <= nextArr) { timeSegIdx = i; break }
    if (nowSec >= stoptimes[i].scheduledArrival && nowSec < dep) { timeSegIdx = Math.max(0, i - 1); break }
  }
  if (timeSegIdx < 0 && stoptimes.length >= 2) {
    const lastDep = stoptimes[stoptimes.length - 1].scheduledDeparture
    if (nowSec >= lastDep) timeSegIdx = stoptimes.length - 2
  }

  // Constrain the geometric search to a window around the time-predicted
  // segment, so the matcher can't lock onto a geometrically-nearer point on a
  // different part of a looping/overlapping route.
  const WINDOW = 3 // stops on either side of the time-predicted segment
  const CLOSE_ENOUGH_M = 300 // if best-in-window is within this, trust it outright

  let searchFrom = 0
  let searchTo = stoptimes.length - 1
  if (timeSegIdx >= 0) {
    searchFrom = Math.max(0, timeSegIdx - WINDOW)
    searchTo = Math.min(stoptimes.length - 1, timeSegIdx + WINDOW)
  }

  let bestSegIdx = timeSegIdx >= 0 ? timeSegIdx : 0
  let bestDist = Infinity
  let bestFraction = 0

  for (let i = searchFrom; i < searchTo; i++) {
    const a = stoptimes[i].stop
    const b = stoptimes[i + 1].stop
    const proj = projectOntoSegment(vLat, vLng, a.lat, a.lon, b.lat, b.lon)
    if (proj.dist < bestDist) {
      bestDist = proj.dist
      bestSegIdx = i
      bestFraction = proj.fraction
    }
  }

  // Only fall back to a full-route search if the windowed search came up bad
  // (vehicle genuinely far from where the schedule says it should be — e.g.
  // real delay/detour — not a matching artifact).
  if (bestDist > CLOSE_ENOUGH_M) {
    for (let i = 0; i < stoptimes.length - 1; i++) {
      if (i >= searchFrom && i < searchTo) continue // already checked
      const a = stoptimes[i].stop
      const b = stoptimes[i + 1].stop
      const proj = projectOntoSegment(vLat, vLng, a.lat, a.lon, b.lat, b.lon)
      if (proj.dist < bestDist) {
        bestDist = proj.dist
        bestSegIdx = i
        bestFraction = proj.fraction
      }
    }
  }

  // Check if vehicle is very close to a stop (within 150m), constrained to the
  // same window so a loop line can't snap to the wrong occurrence of a stop.
  // Stops in dense city centers can sit well under 150m apart, so more than
  // one can be in range at once — take the nearest, not just the first one
  // hit while scanning in index order (that used to pick an earlier, farther
  // stop over a much closer later one).
  let atStopIdx = -1
  let atStopDist = Infinity
  for (let i = searchFrom; i <= searchTo; i++) {
    const d = distanceMeters(vLat, vLng, stoptimes[i].stop.lat, stoptimes[i].stop.lon)
    if (d < 150 && d < atStopDist) {
      atStopIdx = i
      atStopDist = d
    }
  }

  // Only pull the position back to "at this stop" when the projected segment
  // is genuinely adjacent to it (arriving on the segment ending here, or just
  // departed on the segment starting here). Snapping when the projection has
  // already moved a full segment past atStopIdx (bestSegIdx === atStopIdx + 1)
  // used to yank the position two stops backward whenever an earlier, closely
  // spaced stop was merely still within range — turning an on-time vehicle
  // into one that looked minutes late against a stop it had already served.
  if (atStopIdx >= 0 && (bestSegIdx === atStopIdx - 1 || bestSegIdx === atStopIdx)) {
    bestSegIdx = Math.max(0, atStopIdx - 1)
    bestFraction = atStopIdx === 0 ? 0 : 1
  }

  // Calculate actual delay based on GPS position vs schedule.
  // Use the next upcoming stop for delay calculation — more accurate.
  const nextStopIdx = bestSegIdx + 1
  const refStop = nextStopIdx < stoptimes.length ? stoptimes[nextStopIdx] : stoptimes[bestSegIdx]
  const scheduledTimeSec = refStop.scheduledArrival
  // Always the raw GPS-time-vs-schedule gap for the reference stop — no
  // proximity-based zeroing. A moving vehicle passes within meters of nearly
  // every stop it serves, and even the dedicated at-stop check (atStopIdx)
  // is itself just another proximity threshold, so gating on either one
  // zeroed out a genuinely late bus's delay the instant it neared (not
  // necessarily reached) any stop, then let it reappear once past — a
  // flicker that looked like "now it says on time" for a bus that never
  // stopped being late.
  // Exception: a vehicle still sitting at stop 0 — the trip's origin —
  // hasn't actually pulled out yet. This is the one proximity case worth
  // gating on despite the no-zeroing rule above: origin stops double as
  // depots/layover points (see GPS_TYPE_MAP's trolleybus depot comment in
  // constants.ts), and a bus dwelling there before departure isn't "running
  // late" in any rider-facing sense — it just hasn't started. Without this,
  // a bus held at the depot past its scheduled departure racks up delay
  // against the *next* stop's schedule the whole time it's still parked.
  const delaySeconds = atStopIdx === 0 ? 0 : nowSec - scheduledTimeSec

  return { afterStopIndex: bestSegIdx, fraction: bestFraction, atStopIndex: atStopIdx, delaySeconds }
}

export interface StatusFromGPS {
  stops: TripStopInfo[]
  afterStopIndex: number
  fraction: number
  delaySeconds: number
}

// Full per-stop status derivation for a single trip, built on matchVehicleToTrip.
export function computeStatusFromGPS(
  stoptimes: DelayStoptime[],
  vLat: number,
  vLng: number,
  nowSec: number,
): StatusFromGPS {
  const match = matchVehicleToTrip(stoptimes, vLat, vLng, nowSec)
  const { afterStopIndex: bestSegIdx, fraction: bestFraction, atStopIndex: atStopIdx, delaySeconds } = match

  const stops: TripStopInfo[] = stoptimes.map((st, i) => {
    let status: 'passed' | 'current' | 'upcoming' = 'upcoming'
    if (i < bestSegIdx || (i === bestSegIdx && bestFraction > 0.9)) {
      status = 'passed'
    } else if (i === bestSegIdx) {
      status = 'passed'
    } else if (atStopIdx >= 0 && i === atStopIdx) {
      status = 'current'
    }
    return {
      name: st.stop.name,
      lat: st.stop.lat,
      lng: st.stop.lon,
      stopId: st.stop.gtfsId || '',
      scheduledArrival: st.scheduledArrival,
      scheduledDeparture: st.scheduledDeparture,
      status,
    }
  })

  // scheduledArrival/scheduledDeparture stay as the true published schedule —
  // never shifted — so they mean the same thing everywhere they're shown.
  // delaySeconds is attached separately; callers that want a live ETA add it
  // back in explicitly instead of it being silently baked into "scheduled".
  const stopsWithDelay: TripStopInfo[] = stops.map((stop) => {
    if (stop.status === 'passed') return stop
    return { ...stop, delaySeconds }
  })

  return { stops: stopsWithDelay, afterStopIndex: bestSegIdx, fraction: bestFraction, delaySeconds }
}
