import { transit_realtime } from 'gtfs-realtime-bindings'
import {
  ELRON_VEHICLE_POSITIONS_URL,
  ELRON_AGENCY_GTFS_ID,
  GPS_FEED_TIMEOUT_MS,
} from './constants'

export interface ElronVehicle {
  // The OTP trip gtfsId this train is running — see toOtpTripId. Elron's feed
  // carries no vehicle identity of its own (no vehicle.id, no label), so the
  // trip is also the only stable key available for one physical train.
  tripId: string
  lat: number
  lng: number
}

// OTP namespaces every id it exposes with the feed it was loaded from, so the
// bare GTFS trip_id in the real-time feed is not what trip(id:), plan legs, or
// tripsForDate report — they all carry this prefix. It's the same feed
// ELRON_AGENCY_GTFS_ID names, so derive it from there rather than hardcoding
// the number twice. Confirmed live: all 17 trains in a sample joined 1:1 to a
// trip in today's graph under this prefix, and 0 under the stale duplicate
// copy of Elron's schema the graph also carries (see ELRON_AGENCY_GTFS_ID).
const OTP_FEED_PREFIX = `${ELRON_AGENCY_GTFS_ID.split(':')[0]}:`

export function toOtpTripId(realtimeTripId: string): string {
  return `${OTP_FEED_PREFIX}${realtimeTripId}`
}

let cache: { data: ElronVehicle[]; timestamp: number } | null = null
// Longer than Tallinn's own GPS cache TTL — this is someone else's
// community-run mirror (see ELRON_VEHICLE_POSITIONS_URL), not our own
// infrastructure, so there's no reason to hammer it faster than the endpoints
// consuming it can even make use of. Shared process-wide so /api/vehicles and
// /api/delays polling in parallel cost one upstream fetch, not two.
const CACHE_TTL = 10_000

// Position only: the feed carries no bearing, speed, line, or headsign (all
// confirmed absent across every entity in a live sample), so consumers have to
// resolve those from the matched trip's own schedule and geometry.
export async function fetchElronVehicles(): Promise<ElronVehicle[]> {
  const now = Date.now()
  if (cache && now - cache.timestamp < CACHE_TTL) {
    return cache.data
  }
  try {
    const response = await fetch(ELRON_VEHICLE_POSITIONS_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(GPS_FEED_TIMEOUT_MS),
    })
    if (!response.ok) return cache?.data || []
    const feed = transit_realtime.FeedMessage.decode(new Uint8Array(await response.arrayBuffer()))
    const vehicles: ElronVehicle[] = []
    for (const entity of feed.entity) {
      // entity.id is NOT usable as a key — it's the trip_id plus a
      // per-submission timestamp suffix that changes on every poll.
      const realtimeTripId = entity.vehicle?.trip?.tripId
      const position = entity.vehicle?.position
      if (!realtimeTripId || !position) continue
      vehicles.push({
        tripId: toOtpTripId(realtimeTripId),
        lat: position.latitude,
        lng: position.longitude,
      })
    }
    cache = { data: vehicles, timestamp: now }
    return vehicles
  } catch {
    // Unofficial third-party feed — never let it take a whole endpoint down;
    // fall back to the last good sample (or empty on first failure).
    return cache?.data || []
  }
}
