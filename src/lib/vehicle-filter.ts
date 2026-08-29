import { VehiclePosition, TransportMode } from './types'
import { distanceMeters } from './delay'
import { CITY_RELEVANCE_RADIUS_M } from './constants'

export interface LineFilter {
  mode: TransportMode
  line: string
  // Where the line was picked (the geocode anchor, or the tapped vehicle's own
  // position). Line numbers are reused nationwide -- see the comment on
  // TALLINN_TRANSPORT_AGENCY_GTFS_ID in constants.ts -- so "bus 5" with every
  // city active would otherwise keep half a dozen unrelated towns' buses.
  anchor?: { lat: number; lng: number }
}

export function matchesLineFilter(v: VehiclePosition, filter: LineFilter): boolean {
  if (v.mode !== filter.mode || v.line !== filter.line) return false
  if (!filter.anchor) return true
  return distanceMeters(v.lat, v.lng, filter.anchor.lat, filter.anchor.lng) <= CITY_RELEVANCE_RADIUS_M
}

export function applyLineFilter(
  vehicles: VehiclePosition[] | undefined,
  filter: LineFilter | null,
): VehiclePosition[] | undefined {
  if (!filter || !vehicles) return vehicles
  return vehicles.filter((v) => matchesLineFilter(v, filter))
}
