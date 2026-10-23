import { RouteLeg } from '@/lib/types'
import { decodePolyline } from '@/lib/decode-polyline'
import { encodePolyline } from '@/lib/encode-polyline'

// Longest wait at the joining stop for two legs to still count as one ride.
const MAX_JOIN_GAP_SEC = 10 * 60

function isSameStop(a: RouteLeg['to'], b: RouteLeg['from']): boolean {
  if (a.stopId && b.stopId) return a.stopId === b.stopId
  return a.name === b.name
}

// OTP sometimes reports one ride as two consecutive legs (same trip split at a
// stop, or a line that continues as a second trip at the same stop). Shown as
// is, the vehicle appears twice. Two adjacent legs are one ride when they are
// the same line and mode and the second starts at the stop the first ends at.
export function canMergeLegs(a: RouteLeg, b: RouteLeg): boolean {
  if (a.mode === 'walk' || b.mode === 'walk' || a.mode !== b.mode) return false
  const sameLine = a.routeGtfsId ? a.routeGtfsId === b.routeGtfsId : !!a.route && a.route === b.route
  if (!sameLine || !isSameStop(a.to, b.from)) return false
  if (a.tripId && a.tripId === b.tripId) return true
  const gapSec = (new Date(b.startTime).getTime() - new Date(a.endTime).getTime()) / 1000
  return gapSec <= MAX_JOIN_GAP_SEC
}

function mergeTwo(a: RouteLeg, b: RouteLeg): RouteLeg {
  const points =
    a.legGeometry && b.legGeometry
      ? encodePolyline([...decodePolyline(a.legGeometry.points), ...decodePolyline(b.legGeometry.points)])
      : (a.legGeometry ?? b.legGeometry)?.points
  const stops = a.intermediateStops || b.intermediateStops ? [...(a.intermediateStops ?? []), a.to, ...(b.intermediateStops ?? [])] : undefined
  const alerts = [...(a.alerts ?? []), ...(b.alerts ?? [])]
  return {
    ...a,
    to: b.to,
    endTime: b.endTime,
    duration: Math.round((new Date(b.endTime).getTime() - new Date(a.startTime).getTime()) / 1000),
    intermediateStops: stops,
    legGeometry: points ? { points } : undefined,
    alerts: alerts.length ? alerts : undefined,
    realtimeState: a.realtimeState === 'canceled' || b.realtimeState === 'canceled' ? 'canceled' : a.realtimeState,
  }
}

export function mergeSplitLegs(legs: RouteLeg[]): RouteLeg[] {
  const out: RouteLeg[] = []
  for (const leg of legs) {
    const prev = out[out.length - 1]
    if (prev && canMergeLegs(prev, leg)) out[out.length - 1] = mergeTwo(prev, leg)
    else out.push(leg)
  }
  return out
}
