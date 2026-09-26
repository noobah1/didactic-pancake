// Joining Elron's live positions onto the OTP graph's trips.
//
// Elron's real-time trip ids and the schedule graph's trip ids are the same
// string (see toOtpTripId in elron.ts) — as long as both were produced from
// the same timetable publication. Each id embeds that publication in its
// service-period prefix ("Ida,_Lõuna_31.08-1.11.2026-Sa-…"), so the moment
// Elron republishes and the graph hasn't caught up (it's rebuilt from an
// upstream GTFS mirror, daily at best), every exact join misses and every
// train silently degrades to a schedule guess.
//
// The parts of the id that identify the trip itself — the operator region, the
// pattern hash, the direction/variant and the departure time — are stable
// across publications, so they make a usable fallback key. It is a fallback,
// never a replacement: an exact id match always wins, and a fuzzy one is only
// accepted when it is unambiguous AND the train is actually near that trip's
// shape, so a wrong guess can't put a train on the wrong line.

import { findNearestPointIndex } from '@/lib/shape-geometry'
import { distanceMeters } from '@/lib/delay'

const DAY_TOKEN = /-(?:Mo|Tu|We|Th|Fr|Sa|Su)-/

// A train further than this from every vertex of the candidate trip's shape is
// not on that trip. Generous on purpose — shape vertices can be a couple of km
// apart on straight track — since the key match is already very specific.
const MAX_SHAPE_DISTANCE_M = 3_000

// "1:Laane_31.08.-31.12.2026-Sa-a627…-B-IB-1632-0767ac1"
//   → "Laane|a627…-B-IB-1632"
// Drops the feed prefix, the service period, the day-of-week and the trailing
// per-publication hash; keeps region, pattern id, direction and departure time.
// Null when the id doesn't have that shape at all.
export function elronTripMatchKey(tripId: string): string | null {
  const bare = tripId.replace(/^\d+:/, '')
  const region = bare.match(/^[^_]+/)?.[0]
  const day = DAY_TOKEN.exec(bare)
  if (!region || !day) return null
  const rest = bare.slice(day.index + day[0].length)
  const hashAt = rest.lastIndexOf('-')
  if (hashAt <= 0) return null
  const body = rest.slice(0, hashAt)
  if (!/-\d{4}$/.test(body)) return null
  return `${region}|${body}`
}

export interface MatchableTrip {
  shapeCoords: [number, number][] | null
}

export interface ResolvedTrip<T> {
  // The GRAPH's trip id, which is not necessarily the feed's — everything
  // downstream (trip-stops lookups, dedupe against the schedule estimate) keys
  // off the id OTP knows.
  tripId: string
  info: T
  via: 'exact' | 'fuzzy'
}

// Built once per trips map — the map itself is cached for 30s upstream, and
// there are only a couple of hundred trips in it.
const indexCache = new WeakMap<object, Map<string, string[]>>()

function fuzzyIndex(trips: Map<string, unknown>): Map<string, string[]> {
  const cached = indexCache.get(trips)
  if (cached) return cached
  const index = new Map<string, string[]>()
  for (const id of trips.keys()) {
    const key = elronTripMatchKey(id)
    if (!key) continue
    const bucket = index.get(key)
    if (bucket) bucket.push(id)
    else index.set(key, [id])
  }
  indexCache.set(trips, index)
  return index
}

function isNearShape(shape: [number, number][] | null, lat: number, lng: number): boolean {
  // No geometry to check against — nothing to contradict the key match.
  if (!shape || shape.length < 2) return true
  const lats = shape.map((c) => c[1])
  const lons = shape.map((c) => c[0])
  const i = findNearestPointIndex(lats, lons, lat, lng)
  return distanceMeters(lat, lng, lats[i], lons[i]) <= MAX_SHAPE_DISTANCE_M
}

export function resolveElronTrip<T extends MatchableTrip>(
  feedTripId: string,
  lat: number,
  lng: number,
  trips: Map<string, T>,
): ResolvedTrip<T> | null {
  const exact = trips.get(feedTripId)
  if (exact) return { tripId: feedTripId, info: exact, via: 'exact' }

  const key = elronTripMatchKey(feedTripId)
  if (!key) return null
  const candidates = fuzzyIndex(trips).get(key)
  // Two graph trips sharing a key means the key isn't identifying anything —
  // refuse to pick one rather than guess.
  if (!candidates || candidates.length !== 1) return null
  const info = trips.get(candidates[0])
  if (!info || !isNearShape(info.shapeCoords, lat, lng)) return null
  return { tripId: candidates[0], info, via: 'fuzzy' }
}
