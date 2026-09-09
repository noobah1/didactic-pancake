import { StopInfo } from './types'

// GTFS commonly carries the same physical stop pole under multiple feed_ids
// (e.g. a legacy trolleybus feed alongside the live bus feed) at identical
// coordinates. Left undeduped, the map renders overlapping circles and a
// click always hits whichever feed happened to be listed last — which is
// frequently the one with no vehicleMode and no real schedule data. Collapse
// stops at the same coordinate, preferring the record OTP tagged with a mode.
// Tradeoff: two genuinely distinct stops that round to the same coordinate
// (e.g. a bus and tram stop sharing a corner) would also collapse to one —
// coordinate-identical distinct stops are rare enough in practice that this
// isn't worth real distinct-stop detection, but it is a real limitation.
export function dedupeCoincidentStops(stops: StopInfo[]): StopInfo[] {
  const byLocation = new Map<string, StopInfo>()
  for (const stop of stops) {
    const key = `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`
    const existing = byLocation.get(key)
    if (!existing || (!existing.mode && stop.mode)) {
      byLocation.set(key, stop)
    }
  }
  return [...byLocation.values()]
}
