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
  // OTP's own route id — unambiguous, unlike `route` above (the same line
  // number is reused by unrelated operators nationwide, see
  // TALLINN_TRANSPORT_AGENCY_GTFS_ID's comment). Used to match a leg against
  // RouteTrafficEstimate.routeGtfsId without that collision risk.
  routeGtfsId?: string
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

export interface StopBoardTarget {
  stopId: string
  name: string
  lat: number
  lng: number
}

export interface NearbyStop {
  stopId: string
  name: string
  lat: number
  lng: number
  distanceMeters: number
  departures: StopDeparture[]
}

export interface NearbyStopsData {
  stops: NearbyStop[]
  radiusMeters: number // the radius actually used, after any widening
  widened: boolean
  // Present when OTP failed and this is a served-stale cache entry — same
  // stale-on-error convention as /api/stop-board.
  stale?: boolean
}

export interface FavoriteRoute {
  id: string
  fromName: string
  fromLat: number
  fromLng: number
  toName: string
  toLat: number
  toLng: number
  // "Leave now" reminder — a push notification some minutes before a usual
  // leave-by time, independent of the delay-based push in push-checker.ts.
  // Weekdays only for now (no per-day picker yet).
  reminderEnabled?: boolean
  reminderTime?: string // "HH:MM", 24h, Europe/Tallinn wall-clock
  reminderLeadMinutes?: number // defaults to 10 when unset
}

// A road-speed-inferred slowdown for a whole intercity/regional route — the
// only delay signal that exists for the ~251 routes in
// src/lib/traffic/route-coverage.json, none of which have live GPS or any
// real-time feed at all (see src/lib/traffic/index.ts). Deliberately its own
// type, never merged into DelayedVehicle.delaySeconds or
// TripStopInfo.delaySeconds — those are a specific vehicle's GPS position
// against its own schedule; this is "cars on this road are running slower
// than usual," several removes from any specific bus. `evidence` exists so a
// consumer can never accidentally treat one as the other by field-shape alone.
export interface TrafficEstimate {
  minSeconds: number
  maxSeconds: number
  evidence: 'traffic-estimate'
  // How many distinct Tark Tee detectors contributed to this estimate —
  // shown alongside the number so a rider can judge "one sensor 40km away"
  // from "six sensors along the actual corridor" at a glance.
  detectorCount: number
  // Fraction (0-1) of the route's scheduled in-motion time that a nearby,
  // fresh, baselined detector actually speaks to. Never surfaced as a
  // percentage to riders — it's what gates whether an estimate is shown at
  // all (see MIN_COVERED_FRACTION in traffic/estimate.ts), kept on the type
  // so that gate is inspectable/testable from the outside.
  coveredFraction: number
  // ISO timestamp of the freshest underlying detector reading used — the
  // estimate's own "as of," independent of when /api/delays computed it.
  observedAt: string
}

export interface RouteTrafficEstimate extends TrafficEstimate {
  routeGtfsId: string
  shortName: string
  longName: string
  // Midpoint of the route's covered stretch — same "good enough for roughly
  // where is this" purpose as ServiceAlert.lat/lng, used for the same
  // city-relevance distance filter page.tsx already applies to alerts and
  // GPS-delayed vehicles.
  lat: number
  lng: number
}
