// Pure geometry helpers for working with a trip's route shape (an OTP
// polyline decoded to [lng, lat] pairs, see decode-polyline.ts). Extracted
// from api/vehicles/route.ts's schedule-interpolation path, which snaps a
// stop to its nearest point on the shape and walks a fraction of the way to
// the next one — the exact same operation a crowdsourced rider fix needs
// (src/lib/rider-reports.ts) when it snaps a phone's raw GPS onto the shape
// before anything is stored.

import { distanceMeters, projectOntoSegment } from '@/lib/delay'

export function distSq(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dlat = lat2 - lat1
  const dlon = lon2 - lon1
  return dlat * dlat + dlon * dlon
}

export function findNearestPointIndex(
  shapeLats: number[],
  shapeLons: number[],
  lat: number,
  lon: number,
  searchStart = 0,
): number {
  let bestIdx = searchStart
  let bestDist = Infinity
  for (let i = searchStart; i < shapeLats.length; i++) {
    const d = distSq(shapeLats[i], shapeLons[i], lat, lon)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return bestIdx
}

export function calcHeading(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLng = ((lon2 - lon1) * Math.PI) / 180
  const rLat1 = (lat1 * Math.PI) / 180
  const rLat2 = (lat2 * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(rLat2)
  const x = Math.cos(rLat1) * Math.sin(rLat2) - Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLng)
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360)
}

export function interpolateAlongShape(
  shapeLats: number[],
  shapeLons: number[],
  fromIdx: number,
  toIdx: number,
  fraction: number,
): { lat: number; lng: number; heading: number } {
  if (fromIdx === toIdx) {
    return { lat: shapeLats[fromIdx], lng: shapeLons[fromIdx], heading: 0 }
  }

  const start = Math.min(fromIdx, toIdx)
  const end = Math.max(fromIdx, toIdx)
  const forward = fromIdx <= toIdx

  // Calculate cumulative distances along the shape segment
  const distances = [0]
  for (let i = start + 1; i <= end; i++) {
    const dlat = shapeLats[i] - shapeLats[i - 1]
    const dlon = shapeLons[i] - shapeLons[i - 1]
    distances.push(distances[distances.length - 1] + Math.sqrt(dlat * dlat + dlon * dlon))
  }
  const totalDist = distances[distances.length - 1]
  if (totalDist === 0) {
    return { lat: shapeLats[start], lng: shapeLons[start], heading: 0 }
  }

  const adjustedFraction = forward ? fraction : 1 - fraction
  const targetDist = adjustedFraction * totalDist

  for (let i = 0; i < distances.length - 1; i++) {
    if (targetDist >= distances[i] && targetDist <= distances[i + 1]) {
      const segFrac =
        distances[i + 1] === distances[i]
          ? 0
          : (targetDist - distances[i]) / (distances[i + 1] - distances[i])
      const si = start + i
      const lat = shapeLats[si] + (shapeLats[si + 1] - shapeLats[si]) * segFrac
      const lng = shapeLons[si] + (shapeLons[si + 1] - shapeLons[si]) * segFrac
      const heading = calcHeading(shapeLats[si], shapeLons[si], shapeLats[si + 1], shapeLons[si + 1])
      return { lat, lng, heading }
    }
  }

  // Fallback: last point
  return {
    lat: shapeLats[end],
    lng: shapeLons[end],
    heading: 0,
  }
}

// Running distance (metres) from shape point 0 through each point — the
// prerequisite for placing any lat/lng "along" the shape rather than just
// "near" it. Shared by riding-progress.ts (a rider's own live fix) and
// schedule-offset.ts (a crowdsourced fix): both need the same
// distance-travelled reference line, just against a different clock.
export function cumulativeDistancesM(lats: number[], lons: number[]): number[] {
  const cum = [0]
  for (let i = 1; i < lats.length; i++) {
    cum.push(cum[i - 1] + distanceMeters(lats[i - 1], lons[i - 1], lats[i], lons[i]))
  }
  return cum
}

// Distance travelled along the shape (lats/lons, with cum from
// cumulativeDistancesM) at the point closest to (lat, lng) — found by
// projecting onto every segment, not snapping to the nearest vertex, so a
// fix that lands between two shape points still resolves to a fractional
// distance instead of jumping to whichever endpoint is closer.
export function distanceAlongShape(
  lats: number[],
  lons: number[],
  cum: number[],
  lat: number,
  lng: number,
): number {
  let bestPerpDist = Infinity
  let bestRouteDist = 0
  for (let i = 0; i < lats.length - 1; i++) {
    const { fraction, dist } = projectOntoSegment(lat, lng, lats[i], lons[i], lats[i + 1], lons[i + 1])
    if (dist < bestPerpDist) {
      bestPerpDist = dist
      bestRouteDist = cum[i] + fraction * (cum[i + 1] - cum[i])
    }
  }
  return bestRouteDist
}
