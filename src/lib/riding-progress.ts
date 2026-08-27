import { RouteLeg, LegPlace } from '@/lib/types'
import { decodePolyline } from '@/lib/decode-polyline'
import { findNearestPointIndex, cumulativeDistancesM, distanceAlongShape } from '@/lib/shape-geometry'

// How close to the alight stop counts as "arriving" for the get-off alarm —
// far enough to give a moment's notice before the doors close, close enough
// that GPS noise (worse indoors / on a moving vehicle) doesn't fire it early.
export const ALIGHT_ALARM_RADIUS_M = 250

export interface RidingProgress {
  nextStop: LegPlace
  // Index into this leg's ordered stop list — 0 is leg.from (boarding), the
  // last index is leg.to (alighting).
  nextStopIndex: number
  // Count of stops from nextStop through the alight stop, inclusive — the
  // "N stops to go" a rider reads on screen.
  stopsRemaining: number
  distanceToNextStopM: number
  distanceToAlightM: number
  shouldAlarm: boolean
}

// The full ordered stop list for a leg: from, then whatever intermediate
// stops OTP returned (absent for some legs — see riding-progress.test.ts),
// then to. Every caller below needs the same list, so it's built once here.
function orderedStops(leg: RouteLeg): LegPlace[] {
  return [leg.from, ...(leg.intermediateStops ?? []), leg.to]
}

// A polyline to project the rider's fix onto: the leg's own decoded shape
// when OTP returned one, otherwise the straight lines between its stops.
// Coarser without real geometry (a handful of segments instead of hundreds
// of points), but distanceAlongShape projects onto *segments*, not
// just vertices, so it stays correct either way — a fix sitting between two
// stops still lands at the right fractional distance, not snapped to
// whichever stop happens to be nearest.
function routeShape(leg: RouteLeg, stops: LegPlace[]): { lats: number[]; lons: number[] } {
  const points = leg.legGeometry?.points ? decodePolyline(leg.legGeometry.points) : null
  if (points && points.length >= 2) {
    return { lats: points.map((p) => p[1]), lons: points.map((p) => p[0]) }
  }
  return { lats: stops.map((s) => s.lat), lons: stops.map((s) => s.lng) }
}

// Where a rider currently is along a leg, from nothing but their live GPS
// fix — deliberately time-free. Riding mode has no schedule-adherence signal
// of its own (that's what the delay-evidence tiers in delay.ts /
// traveller-position.ts are for), so this infers progress purely from
// position, the same whether the bus is running early, late, or exactly on
// time. Both the fix and every stop are projected onto the same route
// polyline and compared by distance travelled along it, not straight-line
// distance to each stop — so it gives the right answer even on the very
// first fix of a ride started mid-leg, not just one step at a time.
export function ridingProgress(leg: RouteLeg, fix: { lat: number; lng: number }): RidingProgress {
  const stops = orderedStops(leg)
  const lastIndex = stops.length - 1 // always >= 1: from + to at minimum
  const { lats, lons } = routeShape(leg, stops)
  const cum = cumulativeDistancesM(lats, lons)

  // Map each stop to its route distance by nearest shape vertex, searching
  // forward only so a route that loops back on itself can't snap a later
  // stop to an earlier point the shape happens to pass close to. Real GTFS
  // stops sit right on their route's shape, so vertex-snapping (rather than
  // segment projection) is accurate enough here — precedent in
  // api/vehicles/route.ts's own rail interpolation.
  const stopDist: number[] = []
  let searchFrom = 0
  for (const stop of stops) {
    const idx = findNearestPointIndex(lats, lons, stop.lat, stop.lng, searchFrom)
    stopDist.push(cum[idx])
    searchFrom = idx
  }

  const fixDist = distanceAlongShape(lats, lons, cum, fix.lat, fix.lng)

  let nextStopIndex = lastIndex
  for (let i = 1; i <= lastIndex; i++) {
    if (stopDist[i] >= fixDist) {
      nextStopIndex = i
      break
    }
  }

  const distanceToAlightM = Math.max(0, stopDist[lastIndex] - fixDist)

  return {
    nextStop: stops[nextStopIndex],
    nextStopIndex,
    stopsRemaining: lastIndex - nextStopIndex + 1,
    distanceToNextStopM: Math.max(0, stopDist[nextStopIndex] - fixDist),
    distanceToAlightM,
    shouldAlarm: distanceToAlightM <= ALIGHT_ALARM_RADIUS_M,
  }
}
