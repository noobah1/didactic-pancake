export type TransportMode = 'bus' | 'tram' | 'train' | 'ferry' | 'trolleybus' | 'nightbus'

export interface VehiclePosition {
  id: string
  mode: TransportMode
  line: string
  lat: number
  lng: number
  heading: number
  destination: string
  // true when this position is interpolated from the static timetable (no
  // real-time signal exists for this vehicle at all — most non-Tallinn-agency
  // routes), as opposed to a real GPS fix. Absent/false means real GPS.
  estimated?: boolean
}

export interface RouteResult {
  id: string
  legs: RouteLeg[]
  duration: number // seconds
  startTime: string // ISO timestamp
  endTime: string
  walkDistance: number // meters
}

export interface RouteLeg {
  mode: TransportMode | 'walk'
  from: LegPlace
  to: LegPlace
  startTime: string
  endTime: string
  duration: number
  route?: string // line number
  tripId?: string
  intermediateStops?: LegPlace[]
  legGeometry?: { points: string } // encoded polyline
}

export interface LegPlace {
  name: string
  lat: number
  lng: number
  stopId?: string
  departure?: string
  arrival?: string
}

export interface ServiceAlert {
  id: string
  headerText: string
  descriptionText: string
  severity: 'info' | 'warning' | 'severe'
  affectedRoutes: string[]
  activePeriodStart?: string
  activePeriodEnd?: string
  // A representative point for the disruption (e.g. Tark Tee road closures)
  // so the UI can sort/prioritize by distance to what the user is actually
  // looking at. Absent for OTP-sourced alerts, which have no single location.
  lat?: number
  lng?: number
}

export interface TripStopInfo {
  name: string
  lat: number
  lng: number
  stopId: string
  scheduledArrival: number   // seconds since midnight
  scheduledDeparture: number // seconds since midnight
  status: 'passed' | 'current' | 'upcoming'
  delaySeconds?: number // absent = no live GPS evidence, NEVER default to 0
}

export interface SearchFilters {
  modes: TransportMode[]
  departureTime: 'now' | string // ISO timestamp
}

export interface StopDeparture {
  tripId: string
  line: string
  mode: TransportMode
  headsign: string
  departureEpochSec: number
  realtime: boolean
  // Only present when realtime is true — never default to 0, same rule as
  // TripStopInfo.delaySeconds (absent means no live evidence, not "on time").
  delaySeconds?: number
}

export interface StopBoardData {
  stopName: string
  lat: number
  lng: number
  departures: StopDeparture[]
}

export interface FavoriteRoute {
  id: string
  fromName: string
  fromLat: number
  fromLng: number
  toName: string
  toLat: number
  toLng: number
}
