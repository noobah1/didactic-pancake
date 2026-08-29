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
  // true when this position was corrected using rider evidence rather than
  // being a pure timetable guess — see RiderReport and schedule-offset.ts.
  // Only ever set alongside `estimated: true`: rider evidence replaces a
  // schedule guess, it never overrides or gets confused with real agency
  // GPS. Absent means no rider evidence, never false — same discipline as
  // `estimated` above.
  riderReported?: true
  // Which of the two rider-evidence tiers riderReported is standing for —
  // only meaningful when riderReported is true:
  //  - 'observed': a report from on board this trip is still fresh (within
  //    REPORT_MAX_AGE_MS) — this position is that report's own consensus.
  //  - 'inferred': the freshest report has expired, but the schedule offset
  //    it measured (schedule-offset.ts) hasn't fully decayed yet, so the
  //    marker is still a schedule position shifted by that offset rather
  //    than a snap back to "on time." Weaker evidence than 'observed', but
  //    still better than assuming punctuality with nothing to back it.
  riderConfidence?: 'observed' | 'inferred'
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
  // Whether this specific vehicle is wheelchair accessible, straight from
  // the feed's own GTFS wheelchair_accessible. Three-state on purpose:
  // undefined is "the operator didn't say", which is the majority of
  // Estonian trips (61%) and must never be shown as a no. Only set for
  // transit legs.
  wheelchairAccessible?: boolean
  // Disruptions scoped to this leg's own trip/route (diversions,
  // cancellations, stop closures) — distinct from the city-wide alerts
  // IssuesPanel shows, which never say whether *this* leg is affected.
  // Text comes straight from the feed, same as ServiceAlert.headerText/
  // descriptionText, and is rendered as-is (not translated). Absent means
  // OTP reported nothing for this leg, not that nothing was checked.
  alerts?: LegAlert[]
  // OTP's own realtime verdict for this leg. 'canceled' means the specific
  // trip is no longer running — the one state worth calling out on its own,
  // since the static timetable alone would never reveal it. The others are
  // kept for completeness but not currently rendered differently.
  realtimeState?: 'scheduled' | 'updated' | 'canceled' | 'added' | 'modified'
  intermediateStops?: LegPlace[]
  legGeometry?: { points: string } // encoded polyline
  // Profile-independent fare facts for this leg, resolved server-side from
  // the generated GTFS fare index (see src/lib/fares/). Deliberately carries
  // no money: what a leg costs depends on who is riding (a Tallinn resident
  // rides free, an under-20 rides county lines free), so the price is
  // computed client-side from this plus the rider's own profile — see
  // src/lib/fares/price.ts. Absent means the leg's route mapped to no known
  // fare authority; never treat that as free. Only set for transit legs.
  fare?: LegFare
}

// See RouteLeg.fare's comment for why this carries no money.
export interface LegFare {
  authority: string
  // The operator's own ticket page for this specific leg (GTFS
  // agency_fare_url), used ahead of the tariff's generic fallback URL when
  // present — REM alone spans a dozen unrelated commercial operators, each
  // with its own site.
  fareUrl?: string
}

// How confidently an itinerary's price can be stated — same "never let a
// weaker signal masquerade as a stronger one" rule as TrafficEstimate.evidence
// (see its own comment). 'tariff': every transit leg has a published fixed
// price. 'floor': at least one leg (Elron) is demand-priced, so the total is
// only a lower bound. 'operator': at least one leg (a commercial REM coach)
// has no quotable price at all. 'unknown': at least one leg's authority has
// no tariff row yet. A weaker tier anywhere in the itinerary downgrades the
// whole total — a partial sum presented as a total would be a lie.
export type FareEvidence = 'tariff' | 'floor' | 'operator' | 'unknown'

export interface FareTicket {
  authority: string
  // Absent when evidence is 'operator' or 'unknown' — no number to show.
  cents?: number
  evidence: FareEvidence
  fareUrl?: string
}

export interface ItineraryFare {
  // Absent whenever evidence is 'operator' or 'unknown' — see FareEvidence.
  totalCents?: number
  evidence: FareEvidence
  // One entry per ticket the rider actually buys, after transfer combining:
  // two legs under the same authority within its own transfer window are one
  // ticket, not two.
  tickets: FareTicket[]
  // The oldest `updatedOn` across the tariffs used, so the UI can say
  // "prices as of {date}" — absent only when there were no priced tickets.
  pricesAsOf?: string
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

// A single leg-scoped disruption — see RouteLeg.alerts. Deliberately a
// smaller shape than ServiceAlert (no id/affectedRoutes/lat/lng): it's
// already scoped to one leg by construction, so there's nothing to match
// it against.
export interface LegAlert {
  headerText: string
  descriptionText: string
  severity: 'info' | 'warning' | 'severe'
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

// An accommodation (or other place) result picked from the Departures tab's
// search (see /api/geocode's isStopSearch branch and place-categories.ts's
// ACCOMMODATION_CATEGORIES) — the anchor for PlaceStopsPanel's "stops near
// this place" list, same role StopBoardTarget plays for a single stop.
export interface PlaceStopsTarget {
  name: string
  lat: number
  lng: number
  category?: string
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
  // OSM place category slug (see src/lib/place-categories.ts) for the "to"
  // end, when it was picked from place search rather than a stop or a plain
  // address — 'to' only, since a recent search's "from" is overwhelmingly
  // "current location" or a mere waypoint, never the thing worth iconifying
  // in the chip. Optional and not yet written by any caller — reserved so a
  // future RecentChip can show a category icon without a schema migration;
  // existing localStorage entries simply lack the field.
  toCategory?: string
}

export interface SavedPlace {
  name: string
  lat: number
  lng: number
  // OSM place category slug (see src/lib/place-categories.ts), when this
  // was picked from place search rather than a stop or a plain address —
  // reserved so a future HomeWorkChip can show a category icon. Optional
  // and not yet written by any caller; existing localStorage entries
  // simply lack the field.
  category?: string
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

// A vehicle's position as reconstructed from one or more riders currently on
// board it (see src/lib/rider-reports.ts and /api/rider-report) — the only
// live signal that reaches a bus outside Tallinn and Elron at all, per
// README's "no Estonian city other than Tallinn publishes live vehicle
// positions." Deliberately its own type with its own `evidence` discriminant,
// same discipline as TrafficEstimate.evidence: this is one or more
// unverified phones, weaker evidence than an agency's own GPS feed
// (DelayedVehicle) and must never be mistaken for it by field-shape alone.
// The lat/lng here is always a point snapped onto the trip's route shape —
// never a reporter's raw GPS fix — see rider-reports.ts for why.
export interface RiderReport {
  tripId: string
  lat: number
  lng: number
  heading?: number
  evidence: 'rider-reported'
  reportedAt: number // epoch ms of the freshest contributing report
  reporterCount: number
}
