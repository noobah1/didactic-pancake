import { StopDeparture, NearbyStop, TransportMode } from './types'
import { NEARBY_WIDEN_THRESHOLD } from './constants'

export interface GqlNearbyStoptime {
  scheduledDeparture: number
  realtimeDeparture: number
  realtime: boolean
  serviceDay: number
  headsign?: string | null
  trip: {
    gtfsId: string
    route: { shortName: string; mode: string }
  }
}

export interface GqlNearbyStop {
  gtfsId: string
  name: string
  lat: number
  lon: number
  stoptimesWithoutPatterns: GqlNearbyStoptime[]
}

export interface GqlNearbyEdge {
  node: {
    distance: number
    stop: GqlNearbyStop
  }
}

// Tallinn's unified GTFS feed tags trolleybus routes with GTFS mode BUS (no
// TROLLEYBUS route_type in the data — same limitation as stop-board's and
// plan-query's own copies of this map) — a scheduled trolleybus departure
// shows here as "bus", since nothing in a schedule-only query can tell the
// two apart.
function otpModeToLocal(mode: string): TransportMode {
  const map: Record<string, TransportMode> = {
    BUS: 'bus',
    TRAM: 'tram',
    RAIL: 'train',
    FERRY: 'ferry',
  }
  return map[mode] || 'bus'
}

function mapDeparture(st: GqlNearbyStoptime): StopDeparture {
  return {
    tripId: st.trip.gtfsId,
    line: st.trip.route.shortName,
    mode: otpModeToLocal(st.trip.route.mode),
    headsign: st.headsign || '',
    departureEpochSec: st.serviceDay + (st.realtime ? st.realtimeDeparture : st.scheduledDeparture),
    realtime: st.realtime,
    // Absent means "no live evidence", never default to 0 — same rule as
    // StopDeparture.delaySeconds and TripStopInfo.delaySeconds (types.ts).
    delaySeconds: st.realtime ? st.realtimeDeparture - st.scheduledDeparture : undefined,
  }
}

// stopsByRadius returns duplicate rows for the same physical stop from
// Elron's stale second feed (gtfsId prefix "2:", see ELRON_AGENCY_GTFS_ID in
// constants.ts) — verified live against OTP: identical coordinates, zero
// stoptimes. Dropping any stop with no upcoming departure removes every one
// of those phantoms without hardcoding a feed prefix, and is also the
// semantically right call — a stop with nothing coming is useless here.
// Results also do not arrive sorted by distance (verified live) despite the
// query already extracting `distance` per edge — sort explicitly.
//
// maxPerName caps how many same-named stops (separate platforms/directions
// at one interchange — verified live, e.g. 4x "Mere puiestee" within 160m)
// can occupy the result, so the list shows a variety of nearby places
// instead of one busy interchange's every platform. Left uncapped
// (Infinity) by default so callers that don't care about this — like the
// unit tests below — don't have to think about it.
export function buildNearbyStops(edges: GqlNearbyEdge[], maxStops: number, maxPerName: number = Infinity): NearbyStop[] {
  const sorted = edges
    .filter((e) => e.node.stop.stoptimesWithoutPatterns.length > 0)
    .map((e): NearbyStop => {
      const { stop, distance } = e.node
      const departures = stop.stoptimesWithoutPatterns
        .map(mapDeparture)
        .sort((a, b) => a.departureEpochSec - b.departureEpochSec)
      return {
        stopId: stop.gtfsId,
        name: stop.name,
        lat: stop.lat,
        lng: stop.lon,
        distanceMeters: distance,
        departures,
      }
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters)

  const nameCounts = new Map<string, number>()
  const result: NearbyStop[] = []
  for (const stop of sorted) {
    const count = nameCounts.get(stop.name) || 0
    if (count >= maxPerName) continue
    nameCounts.set(stop.name, count + 1)
    result.push(stop)
    if (result.length >= maxStops) break
  }
  return result
}

// Whether a default-radius result is thin enough to warrant one retry at a
// wider radius (see NEARBY_WIDE_RADIUS_M in constants.ts). Small Estonian
// towns (e.g. Rapla) can have as few as 2 usable stops within 600m.
export function shouldWiden(stops: NearbyStop[]): boolean {
  return stops.length < NEARBY_WIDEN_THRESHOLD
}
