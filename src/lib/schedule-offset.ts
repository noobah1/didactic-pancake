// Turns a single observed position (a rider report — see rider-reports.ts)
// into a schedule offset: how many seconds behind (positive) or ahead
// (negative) of the timetable a trip currently is. This is what
// api/vehicles/route.ts positions a vehicle from, instead of overwriting its
// marker with the raw observed lat/lng directly.
//
// Why an offset instead of a position: a rider report goes stale in minutes
// (REPORT_MAX_AGE_MS in rider-reports.ts), but "this bus was 6 minutes late"
// stays informative well after that — it decays gracefully back toward the
// timetable (see decayOffsetSec) instead of the marker snapping back to a
// stale scheduled position the instant the report expires.

import { cumulativeDistancesM, distanceAlongShape, findNearestPointIndex } from '@/lib/shape-geometry'

export interface OffsetStoptime {
  scheduledDeparture: number
  scheduledArrival: number
  stop: { lat: number; lon: number }
}

// A trip is autocorrelated on roughly this timescale — a bus 6 minutes late
// now is still a good guess for 6 minutes late 10 minutes from now, but says
// less and less the further out you project it. Chosen as a starting point,
// not measured against real Estonian schedule-adherence data.
export const OFFSET_DECAY_TAU_SEC = 600

// Below this, the correction is smaller than the position error it would
// introduce (shape/stop snapping, GPS noise) — treat it as "on time" and
// stop bothering to reposition the vehicle for it.
export const OFFSET_NOISE_FLOOR_SEC = 5

// An offset this stale is pure extrapolation, not evidence — stop applying
// it rather than let it silently keep shaping a position with no report
// behind it at all. 6x OFFSET_DECAY_TAU_SEC leaves it at <0.3% of its
// original value by then anyway; this just stops the math a bit earlier.
export const OFFSET_MAX_AGE_SEC = 3600

// Estimates the schedule clock-time (service-day seconds) at which a trip
// following its timetable would reach (lat, lng) — the inverse of
// api/vehicles/route.ts's own interpolatePosition, which goes time→position.
// Built the same way: map every stop onto the shape (or, lacking one, onto
// the straight lines between stops) to get each stop's own distance
// travelled, then linearly interpolate between whichever two stops bracket
// the fix's own distance travelled.
//
// Returns null if there's nothing to project onto (fewer than 2 stoptimes).
export function scheduledTimeAtPosition(
  stoptimes: OffsetStoptime[],
  shapeCoords: [number, number][] | null,
  lat: number,
  lng: number,
): number | null {
  if (stoptimes.length < 2) return null

  const hasShape = !!shapeCoords && shapeCoords.length > 1
  const lats = hasShape ? shapeCoords!.map((c) => c[1]) : stoptimes.map((s) => s.stop.lat)
  const lons = hasShape ? shapeCoords!.map((c) => c[0]) : stoptimes.map((s) => s.stop.lon)
  const cum = cumulativeDistancesM(lats, lons)
  const fixDist = distanceAlongShape(lats, lons, cum, lat, lng)

  // Each stop's own distance along the same shape, found by searching
  // forward only — same discipline as interpolatePosition's stopShapeIndices
  // (a route that loops back on itself can't snap a later stop to an
  // earlier point the shape happens to pass close to).
  const stopDist: number[] = []
  const stopTime: number[] = []
  let searchFrom = 0
  for (const st of stoptimes) {
    const idx = findNearestPointIndex(lats, lons, st.stop.lat, st.stop.lon, searchFrom)
    stopDist.push(cum[idx])
    stopTime.push(st.scheduledArrival || st.scheduledDeparture)
    searchFrom = idx
  }

  if (fixDist <= stopDist[0]) return stopTime[0]
  const lastIdx = stopDist.length - 1
  if (fixDist >= stopDist[lastIdx]) return stopTime[lastIdx]

  for (let i = 0; i < stopDist.length - 1; i++) {
    if (fixDist >= stopDist[i] && fixDist <= stopDist[i + 1]) {
      const span = stopDist[i + 1] - stopDist[i]
      const frac = span === 0 ? 0 : (fixDist - stopDist[i]) / span
      return stopTime[i] + frac * (stopTime[i + 1] - stopTime[i])
    }
  }
  return stopTime[lastIdx]
}

// How far behind schedule a trip was at the moment of one observation —
// positive means late, negative means early. `nowSec` and the values inside
// `stoptimes` are both service-day seconds (see service-date.ts), so this is
// only meaningful for stoptimes from the same service day as the fix.
export function measureOffsetSec(
  stoptimes: OffsetStoptime[],
  shapeCoords: [number, number][] | null,
  lat: number,
  lng: number,
  observedAtSec: number,
): number | null {
  const scheduledSec = scheduledTimeAtPosition(stoptimes, shapeCoords, lat, lng)
  if (scheduledSec === null) return null
  return observedAtSec - scheduledSec
}

// Decays an observed offset toward 0 (the prior: "assume on-time") as it
// ages, rather than either holding it at full strength forever or dropping
// it the instant the observation itself goes stale. `ageSec` is time since
// the offset was measured, not since the trip started.
export function decayOffsetSec(offsetSec: number, ageSec: number): number {
  if (ageSec <= 0) return offsetSec
  if (ageSec >= OFFSET_MAX_AGE_SEC) return 0
  return offsetSec * Math.exp(-ageSec / OFFSET_DECAY_TAU_SEC)
}
