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
