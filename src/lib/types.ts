export type TransportMode = 'bus' | 'tram' | 'train' | 'ferry' | 'trolleybus' | 'nightbus'

export interface VehiclePosition {
  id: string
  mode: TransportMode
  line: string
  lat: number
  lng: number
  heading: number
  destination: string
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
