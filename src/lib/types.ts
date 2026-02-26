export type TransportMode = 'bus' | 'tram' | 'train' | 'ferry'

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
  realtime?: boolean
  delay?: number // seconds
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

export interface SearchFilters {
  modes: TransportMode[]
  departureTime: 'now' | string // ISO timestamp
}
