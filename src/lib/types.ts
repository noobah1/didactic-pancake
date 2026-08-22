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

// A journey sharer's own live position, attached to a share (see
// share-store.ts) once they opt in to broadcasting it — separate from
// VehiclePosition, which is a transit vehicle, not a person.
export interface SharePosition {
  lat: number
  lng: number
  updatedAt: number // epoch ms
}

// How confident traveller-position.ts's resolved position is, from a real
// fix down to a pure timetable guess — see that file's own comment for the
// full tier ladder. Never conflate with VehiclePosition.estimated: this is
// about a PERSON's position, derived very differently (from a live phone fix,
// or from the vehicle/timetable they're presumed to be on).
export type TravellerSource = 'gps' | 'vehicle' | 'schedule' | 'stale'

// What a shared journey's viewer actually draws — always the output of
// resolveTravellerPosition, never a raw SharePosition rendered directly, so
// the UI can never accidentally show an inferred guess with the same visual
// weight as a real GPS fix.
export interface TravellerPosition {
  lat: number
  lng: number
  source: TravellerSource
  label: string
  ageMs: number
  // Only set for source: 'vehicle' — the transit mode of the vehicle this
  // position was borrowed from, so the marker can be tinted the same as
  // that vehicle's own map color instead of a generic placeholder.
  mode?: TransportMode
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
  // Elron trains only (see src/lib/elron-platform.ts) — absent for every
  // other mode, and when this stop/time/destination couldn't be matched
  // against Elron's own live-map board. Never guess a platform. `from`'s
  // platform is where to board; a train leg's `to` carries one too (the
  // arrival platform), independently matched — they are frequently different
  // tracks at the same station.
  platform?: string
  platformChanged?: boolean
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
  // Elron trains only (see src/lib/elron-platform.ts) — absent for every
  // other mode, and when this stop/time/destination couldn't be matched
  // against Elron's own live-map board. Never guess a platform.
  platform?: string
  platformChanged?: boolean
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
  // Elron trains only (see src/lib/elron-platform.ts) — absent for every
  // other mode, and for a train whose station/time/destination couldn't be
  // matched against Elron's own live-map board. Never guess a platform.
  platform?: string
  platformChanged?: boolean
}

export interface StopBoardData {
  stopName: string
  lat: number
  lng: number
  departures: StopDeparture[]
  // Present when OTP failed and the server served its own stale in-memory
  // cache entry instead (see /api/stop-board) -- same convention as
  // NearbyStopsData.stale below. Distinct from useStopBoard's client-side
  // offline fallback (see use-stop-board.ts): that one kicks in when the
  // request never reached the server at all.
  stale?: boolean
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
}

// An auto-logged trip search, distinct from FavoriteRoute — the rider never
// opted in, so these are capped and pruned (see use-recent-searches.ts)
// rather than kept forever like a favorite.
export interface RecentSearch {
  id: string
  fromName: string
  fromLat: number
  fromLng: number
  toName: string
  toLat: number
  toLng: number
  searchedAt: number // epoch ms
}

export interface SavedPlace {
  name: string
  lat: number
  lng: number
}

// The rider's two named-place shortcuts (see use-home-work.ts). Deliberately
// not a FavoriteRoute — a single place, not a from/to pair, since "home" and
// "work" are each one end of many different trips.
export interface HomeWorkPlaces {
  home?: SavedPlace
  work?: SavedPlace
}

// A compact summary of a favorite route's top itinerary, cached client-side
// after a successful /api/plan search matches a saved FavoriteRoute (see
// use-favorite-departure.ts) -- just enough to show "Bus 12, 14:32 · last
// known 6 min ago" on the favorite's chip later, without keeping full
// RouteResult objects (walk geometry, every leg) around for a trip the
// rider isn't even looking at right now. Deliberately never live -- there's
// no background polling per favorite, so this is always a snapshot of
// whatever the rider last actually searched.
export interface FavoriteDeparture {
  mode: TransportMode
  line?: string
  startTime: string // ISO timestamp, RouteResult.startTime of the cached itinerary
}

// A road-speed-inferred slowdown for a whole route — the only delay signal
// that exists for routes with no live GPS or real-time feed of their own,
// which is most of the country: the ~251 intercity/regional routes in
// src/lib/traffic/route-coverage.json (Tark Tee highway detectors, see
// src/lib/traffic/index.ts) and every city bus route outside Tallinn in
// src/lib/traffic/city-probes.json (TomTom probe points, see
// src/lib/traffic/city-estimate.ts). Deliberately its own
// type, never merged into DelayedVehicle.delaySeconds or
// TripStopInfo.delaySeconds — those are a specific vehicle's GPS position
// against its own schedule; this is "cars on this road are running slower
// than usual," several removes from any specific bus. `evidence` exists so a
// consumer can never accidentally treat one as the other by field-shape alone.
export interface TrafficEstimate {
  minSeconds: number
  maxSeconds: number
  evidence: 'traffic-estimate'
  // How many distinct measurement points contributed to this estimate —
  // Tark Tee detectors for a highway corridor, TomTom probe points for a
  // city route. Shown alongside the number so a rider can judge "one sensor
  // 40km away" from "six sensors along the actual corridor" at a glance.
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
