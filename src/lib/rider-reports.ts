import { RiderReport } from '@/lib/types'
import { projectOntoSegment, distanceMeters } from '@/lib/delay'

// A report older than this can no longer describe where the bus actually is.
// Riding mode's own send interval is 15s (use-riding-mode.ts, modeled on
// use-live-share.ts's MIN_SEND_INTERVAL_MS), so this is a handful of missed
// cycles — the outer bound of "still current," not a stale guess worth
// showing as if it were live.
export const REPORT_MAX_AGE_MS = 2 * 60 * 1000

// A session can update its own report at most this often — riding mode only
// ever sends every 15s anyway, this just bounds how much damage a buggy or
// hostile client can do by spamming.
const MIN_REPORT_INTERVAL_MS = 5_000

// Caps memory per trip and keeps one noisy or malicious burst of sessions
// from being able to dominate a consensus by sheer numbers.
const MAX_REPORTERS_PER_TRIP = 30

// A report further than this from the pack's rough centre is treated as an
// outlier and dropped before the final position is computed — one stray fix
// (a phone that briefly reads indoors, or a rider who hasn't boarded yet)
// shouldn't drag a consensus of many good ones off the route.
const OUTLIER_RADIUS_M = 300

// One rider's current snapped position — kept in memory only, never
// persisted to disk and never returned from any endpoint as-is (only
// consensusFor's aggregate is). `sessionId` exists purely to let a rider
// update or be superseded by their own later report; it is deliberately not
// part of RiderReport, the type any endpoint actually returns.
interface StoredReport {
  sessionId: string
  lat: number
  lng: number
  heading?: number
  reportedAt: number
}

const reportsByTrip = new Map<string, StoredReport[]>()

// Trip ids currently carrying a fresh report — what api/vehicles/route.ts
// needs to know which trips are worth measuring a schedule offset for (see
// schedule-offset.ts), without it having to duplicate REPORT_MAX_AGE_MS's
// own freshness rule or reach into reportsByTrip directly. Sweeps every
// trip's list first, same as consensusFor would, so an id present here is
// guaranteed to also produce a non-null consensusFor result.
export function reportedTripIds(nowMs: number): string[] {
  const ids: string[] = []
  for (const tripId of [...reportsByTrip.keys()]) {
    if (sweep(tripId, nowMs).length > 0) ids.push(tripId)
  }
  return ids
}

function sweep(tripId: string, nowMs: number): StoredReport[] {
  const list = reportsByTrip.get(tripId)
  if (!list) return []
  const fresh = list.filter((r) => nowMs - r.reportedAt <= REPORT_MAX_AGE_MS)
  if (fresh.length === 0) reportsByTrip.delete(tripId)
  else reportsByTrip.set(tripId, fresh)
  return fresh
}

// Projects a raw fix onto a route shape (the same segment-projection
// riding-progress.ts uses to place a rider along a leg, applied here for
// privacy instead: what recordReport ever stores, and what any endpoint can
// return, is this snapped point — "where on the route the bus is" — never
// the raw fix that produced it). Null only if the shape has fewer than two
// points to project onto.
export function snapToShape(
  lat: number,
  lng: number,
  shapeLats: number[],
  shapeLons: number[],
): { lat: number; lng: number } | null {
  if (shapeLats.length < 2) return null
  let bestDist = Infinity
  let bestPoint = { lat: shapeLats[0], lng: shapeLons[0] }
  for (let i = 0; i < shapeLats.length - 1; i++) {
    const { fraction, dist } = projectOntoSegment(
      lat, lng,
      shapeLats[i], shapeLons[i],
      shapeLats[i + 1], shapeLons[i + 1],
    )
    if (dist < bestDist) {
      bestDist = dist
      bestPoint = {
        lat: shapeLats[i] + fraction * (shapeLats[i + 1] - shapeLats[i]),
        lng: shapeLons[i] + fraction * (shapeLons[i + 1] - shapeLons[i]),
      }
    }
  }
  return bestPoint
}

// Records one rider's fix against a trip, snapping it onto the given route
// shape first. Returns false (and stores nothing) if the shape can't be
// projected onto, the session is updating faster than MIN_REPORT_INTERVAL_MS
// allows, or the trip already has MAX_REPORTERS_PER_TRIP distinct sessions.
export function recordReport(input: {
  tripId: string
  sessionId: string
  lat: number
  lng: number
  heading?: number
  shapeLats: number[]
  shapeLons: number[]
  nowMs: number
}): boolean {
  const { tripId, sessionId, lat, lng, heading, shapeLats, shapeLons, nowMs } = input
  const snapped = snapToShape(lat, lng, shapeLats, shapeLons)
  if (!snapped) return false

  const list = sweep(tripId, nowMs)
  const existing = list.find((r) => r.sessionId === sessionId)
  if (existing && nowMs - existing.reportedAt < MIN_REPORT_INTERVAL_MS) return false
  if (!existing && list.length >= MAX_REPORTERS_PER_TRIP) return false

  const next = list.filter((r) => r.sessionId !== sessionId)
  next.push({ sessionId, lat: snapped.lat, lng: snapped.lng, heading, reportedAt: nowMs })
  reportsByTrip.set(tripId, next)
  return true
}

function median(sortedValues: number[]): number {
  const mid = Math.floor(sortedValues.length / 2)
  return sortedValues.length % 2 !== 0
    ? sortedValues[mid]
    : (sortedValues[mid - 1] + sortedValues[mid]) / 2
}

// The current best-guess position for a trip from whatever fresh reports
// exist, or null if none do. Combines every fresh report after dropping
// outliers (see OUTLIER_RADIUS_M) rather than trusting a single phone,
// consistent with `evidence: 'rider-reported'` meaning "the crowd," not "one
// unverified fix."
export function consensusFor(tripId: string, nowMs: number): RiderReport | null {
  const list = sweep(tripId, nowMs)
  if (list.length === 0) return null

  const medianLat = median([...list.map((r) => r.lat)].sort((a, b) => a - b))
  const medianLng = median([...list.map((r) => r.lng)].sort((a, b) => a - b))
  const kept = list.filter((r) => distanceMeters(r.lat, r.lng, medianLat, medianLng) <= OUTLIER_RADIUS_M)
  const source = kept.length > 0 ? kept : list

  const lat = source.reduce((sum, r) => sum + r.lat, 0) / source.length
  const lng = source.reduce((sum, r) => sum + r.lng, 0) / source.length
  const headings = source.map((r) => r.heading).filter((h): h is number => h != null)

  return {
    tripId,
    lat,
    lng,
    heading: headings.length > 0 ? headings[headings.length - 1] : undefined,
    evidence: 'rider-reported',
    reportedAt: Math.max(...source.map((r) => r.reportedAt)),
    reporterCount: source.length,
  }
}
