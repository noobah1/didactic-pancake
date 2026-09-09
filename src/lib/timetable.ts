import { TripStopInfo } from './types'

export function trimStops(stops: TripStopInfo[]): TripStopInfo[] {
  let lastPassedIdx = -1
  for (let i = stops.length - 1; i >= 0; i--) {
    if (stops[i].status === 'passed') {
      lastPassedIdx = i
      break
    }
  }
  const from = Math.max(0, lastPassedIdx - 1)
  return stops.slice(from)
}

export interface ArrivalInfo {
  minutes: number
  late: boolean
}

// Lateness: GPS says the bus hasn't reached the stop yet + schedule says it
// should have (+ 59s buffer). No prediction — just facts: is the bus there or
// not, and is the time past. The buffer absorbs polling/rounding jitter so a
// bus a few seconds behind isn't flagged late.
export function computeArrivalInfo(scheduledArrival: number, nowSec: number): ArrivalInfo {
  const diff = scheduledArrival - nowSec
  if (diff >= -59) {
    return { minutes: Math.max(0, Math.ceil(diff / 60)), late: false }
  }
  return { minutes: Math.ceil(Math.abs(diff) / 60), late: true }
}
