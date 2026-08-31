import { TransportMode } from './types'

export const OTP_BASE_URL = process.env.OTP_BASE_URL || 'http://localhost:8080'
export const GPS_FEED_URL = 'https://transport.tallinn.ee/gps.txt'
// None of the OTP GraphQL calls used to bound how long they'd wait — a slow
// query (busy interchanges with many overlapping routes/patterns, e.g.
// Linnahall/Mere puiestee, produce the biggest candidate sets and are the
// most likely to be slow) just hung the request indefinitely instead of
// failing fast, which reads to a rider as "the app isn't loading" with no
// error and no retry, regardless of their own connection speed.
export const OTP_FETCH_TIMEOUT_MS = 8_000
export const GPS_FEED_TIMEOUT_MS = 5_000
// Elron's own real-time trains, converted to GTFS-RT by the Transitous
// project (crowdsourcing.transitous.org) — not published by Elron itself, so
// treat it as lower-reliability than Tallinn's own feed above: it can change
// format or go dark without notice.
export const ELRON_VEHICLE_POSITIONS_URL = 'https://jbb.ghsq.de/gtfs/elron/VehiclePositions'

// Tallinn's bus/tram/trolleybus/nightbus fleet (the only modes with live GPS —
// see GPS_TYPE_MAP below) is run by a single agency, but the national GTFS
// feed this OTP graph is built from bundles in dozens of unrelated regional
// operators too, and low route numbers ("1".."30") are reused nationwide —
// e.g. shortName "2" alone matches Tallinn's trolleybus 2 AND ~10 other
// towns' unrelated bus 2. Any OTP route lookup meant to match a live Tallinn
// GPS vehicle must be scoped to this agency, or it can silently match a
// same-numbered route from a completely different town — producing wrong
// delay numbers, a vehicle whose matched trip flips between two unrelated
// routes, or "no schedule found" when the real match loses a confidence
// tiebreak against an unrelated look-alike.
export const TALLINN_TRANSPORT_AGENCY_GTFS_ID = '1:10312960'

// Elron's schedule is loaded into the graph twice — once embedded in the
// national unified feed (agency gtfsId prefix "1:"), once from its own
// dedicated otp/data/elron.zip (prefix "2:") — confirmed live against the
// graph: same agency, same routes, different trip counts for today (205 vs
// 103). elron.zip is committed once and never refreshed by CI (unlike the
// unified feed, which is re-downloaded weekly — see
// .github/workflows/build-otp-graph.yml), so it drifts stale; the unified
// feed's copy is the one that's actually kept current.
export const ELRON_AGENCY_GTFS_ID = '1:10520953'

// Elron's own live-map page (elron.ee) calls this undocumented endpoint —
// found in its bundled JS — to build the station board shown at
// elron.ee/peatused/{station}. Unlike the GTFS feeds above, individual rows
// here carry a platform ("peatuskoht") per departing train. Confirmed live:
// Tapa returns exactly platforms {1,2,4,5}, matching Elron's own published
// Tapa platform notice; Balti jaam (Tallinn) returns 1-9 matching its known
// track count. No GTFS-RT feed or static GTFS field carries this anywhere
// (both rail stops in the graph, "1:10137"/"1:10138", have platformCode
// null) — this is the only source of platform data found. Cloudflare-fronted
// and 403s a bare urllib/no-UA request, so always send a real User-Agent.
export const ELRON_LIVE_MAP_STOP_URL = 'https://elron.ee/live-map/stop/'
// Elron's own site polls this for its live map, and only tegelik_aeg/status
// fields change between polls — the platform assignment itself is set well
// ahead of time. 60s keeps the board feeling live without hammering someone
// else's production site on every /api/stop-board poll (which happens every
// POLL_INTERVALS.stopBoard = 20s).
export const ELRON_PLATFORM_CACHE_TTL = 60_000
// A few station names differ between the OTP graph (GTFS stop_name) and
// Elron's own live-map station list even after foldName() folding — verified
// live: of 125 GTFS rail stop names, 123 match one of Elron's 141 station
// names once folded; these are the 2 exceptions (the ~18 further names on
// Elron's side are all Rail Baltica-adjacent Latvian/Lithuanian stations
// Elron trains don't actually call at in this graph). Keys here are already
// folded (foldName output), matching how the lookup lib applies this map.
export const ELRON_STATION_NAME_ALIASES: Record<string, string> = {
  'klooga aedlinn': 'klooga-aedlinn',
  'riia raudteejaam': 'riia',
}

// Tark Tee's live traffic-detector layer — the same unauthenticated ArcGIS
// host getRoadDisruptionAlerts() already queries for road closures (see
// tarktee.ts) also serves current per-detector speed/flow readings.
// Confirmed live: 116 records, average_speed_forwards/backwards (km/h),
// relative_speed_forwards/backwards (a coarse coded level), flow, refreshed
// roughly every 5 minutes — no DATEX II key needed (src/lib/traffic/index.ts
// used to say otherwise; this proved that wrong). See
// src/lib/traffic/detectors.ts.
export const TARKTEE_DETECTORS_SERVICE = 'traffic_detectors'
// Readings refresh ~every 5 min on Tark Tee's side; polling faster than that
// only hammers someone else's public infra for data that hasn't changed —
// same spirit as tarktee.ts's own DISRUPTIONS_CACHE_TTL.
export const DETECTOR_CACHE_TTL = 60_000
// A detector reading older than this says nothing trustworthy about current
// conditions — a stalled upstream feed must stop feeding the traffic
// estimate rather than silently keep it "current" on stale numbers.
export const MAX_READING_AGE_MS = 20 * 60_000

// TomTom's Traffic Flow Segment Data — current vs. free-flow speed for the
// road nearest a coordinate. This is the only delay signal that reaches a
// city bus outside Tallinn: Tallinn's gps.txt is Tallinn-only (verified: all
// 394 vehicles in one live sample sat inside lat 59.35-59.52, lon
// 24.59-24.91), no other Estonian city publishes vehicle positions
// (api.peatus.ee runs the national Digitransit/OTP and reports
// "realtime": false for every departure, Tallinn's included; Transitous'
// feeds/ee.json lists exactly one GTFS-RT source for the whole country,
// Elron's), and Tark Tee's own detectors are state-highway sensors with only
// 0-3 sites within 5km of any city centre. See src/lib/traffic/tomtom.ts.
//
// Unlike every other upstream in this file, the exact request/response shape
// below has NOT been confirmed against the live service — this shipped
// without an API key, so the client is written defensively and the whole
// feature stays off until TOMTOM_API_KEY is set.
export const TOMTOM_FLOW_URL = 'https://api.tomtom.com/traffic/services/4/flowSegmentData'
// Zoom decides which road classes TomTom will snap a probe point to: low
// zoom biases to motorways/major roads, high zoom includes local streets.
// City bus routes run on exactly the smaller streets a highway-biased zoom
// would skip, so this sits high rather than at the 10 TomTom's own examples
// use. Worth re-checking against real responses once a key exists — a probe
// that snaps to the wrong road class reads as a slowdown that isn't there.
export const TOMTOM_FLOW_ZOOM = 12
export const TOMTOM_FLOW_TIMEOUT_MS = 5_000
// Below this reported confidence, TomTom is largely extrapolating from
// historical patterns rather than current observations — the same "don't
// publish a number that's more extrapolation than measurement" bar
// MIN_COVERED_FRACTION applies at the route level.
export const TOMTOM_MIN_CONFIDENCE = 0.3
// How long one probe's reading is reused before it's worth spending another
// request. TomTom refreshes flow far faster than this; the limit here is the
// request budget, not the data. Paired with MAX_READING_AGE_MS above: once a
// reading ages past that (budget exhausted, or the service is down) it stops
// counting entirely rather than quietly speaking for current conditions.
export const CITY_FLOW_CACHE_TTL = 10 * 60_000
// Hard daily ceiling on requests to TomTom, whose free tier is ~2,500/day.
// Counted per UTC day, in-process — a restart resets it, and two instances
// each get their own allowance, so leave headroom rather than setting this
// at exactly the plan limit.
export const TOMTOM_DAILY_REQUEST_BUDGET = Number(process.env.TOMTOM_DAILY_REQUEST_BUDGET) || 2_000
// Refreshing all 129 probes at once would spend 5% of the daily budget in a
// single request cycle, and no rider is looking at fourteen cities at once.
// Stale probes are refreshed in the caller's own priority order (the cities
// actually being viewed first), capped here.
export const MAX_PROBE_REFRESH_PER_CYCLE = 40

// Tark Tee's authenticated DATEX II gate (tarktee.mnt.ee/#/et/datex) — unlike
// the unauthenticated ArcGIS endpoint above (detectors/closures), this is the
// only source in the app for SRTI safety-hazard events: slippery/icy road,
// animals/debris/fallen trees on the road, unprotected accident areas,
// reduced visibility, unmanaged road blockages, and exceptional weather
// (heavy snow/wind/freezing rain). Confirmed live with a real key: auth is a
// X-DATEX-API-KEY request header, JSON is the default response format for
// these feeds. See src/lib/traffic/datex-srti.ts. Whole feature is off
// unless DATEX_API_KEY is set (same convention as TOMTOM_API_KEY above).
export const DATEX_BASE_URL = 'https://tarktee.transpordiamet.ee/api/v1/datex/srti'
// SRTI events are derived from road weather station thresholds and Estonia's
// 112 accident feed, not sub-minute sensor churn — polling faster than this
// only hammers Transpordiamet's infra for data that hasn't changed, same
// spirit as tarktee.ts's DISRUPTIONS_CACHE_TTL (which this matches exactly,
// since both ultimately describe the same kind of "current road hazard").
export const DATEX_SRTI_CACHE_TTL = 5 * 60_000

export const TALLINN_CENTER = { lat: 59.437, lng: 24.7536 }
export const DEFAULT_ZOOM = 13

export interface CityDef {
  id: string
  name: string
  county: string
  lat: number
  lng: number
  zoom: number
  // Approximate resident population — used only to break line-search ties
  // between same-numbered routes in different towns (see nearestCityPopulation
  // in stop-search.ts); never displayed to the rider, so doesn't need to be
  // exact or kept in sync with the census.
  population: number
}

export const COUNTIES = [
  'Harjumaa',
  'Tartumaa',
  'Ida-Virumaa',
  'Pärnumaa',
  'Viljandimaa',
  'Lääne-Virumaa',
  'Saaremaa',
  'Läänemaa',
  'Raplamaa',
  'Järvamaa',
  'Jõgevamaa',
  'Põlvamaa',
  'Valgamaa',
  'Võrumaa',
  'Hiiumaa',
] as const

export const CITIES: CityDef[] = [
  // Harju
  { id: 'tallinn', name: 'Tallinn', county: 'Harjumaa', lat: 59.437, lng: 24.7536, zoom: 11, population: 438_000 },
  { id: 'maardu', name: 'Maardu', county: 'Harjumaa', lat: 59.479, lng: 25.015, zoom: 12, population: 15_400 },
  { id: 'keila', name: 'Keila', county: 'Harjumaa', lat: 59.303, lng: 24.414, zoom: 13, population: 10_100 },
  { id: 'saue', name: 'Saue', county: 'Harjumaa', lat: 59.322, lng: 24.549, zoom: 13, population: 6_700 },
  // Tartu
  { id: 'tartu', name: 'Tartu', county: 'Tartumaa', lat: 58.378, lng: 26.729, zoom: 12, population: 91_000 },
  { id: 'elva', name: 'Elva', county: 'Tartumaa', lat: 58.222, lng: 26.418, zoom: 13, population: 5_700 },
  // Ida-Viru
  { id: 'narva', name: 'Narva', county: 'Ida-Virumaa', lat: 59.379, lng: 28.179, zoom: 13, population: 53_000 },
  { id: 'kohtla-jarve', name: 'Kohtla-Järve', county: 'Ida-Virumaa', lat: 59.398, lng: 27.273, zoom: 13, population: 32_000 },
  { id: 'johvi', name: 'Jõhvi', county: 'Ida-Virumaa', lat: 59.359, lng: 27.421, zoom: 13, population: 9_800 },
  { id: 'sillamae', name: 'Sillamäe', county: 'Ida-Virumaa', lat: 59.396, lng: 27.764, zoom: 13, population: 12_000 },
  { id: 'narva-joesuu', name: 'Narva-Jõesuu', county: 'Ida-Virumaa', lat: 59.458, lng: 28.041, zoom: 13, population: 2_300 },
  // Pärnu
  { id: 'parnu', name: 'Pärnu', county: 'Pärnumaa', lat: 58.385, lng: 24.497, zoom: 12, population: 40_000 },
  { id: 'sindi', name: 'Sindi', county: 'Pärnumaa', lat: 58.399, lng: 24.662, zoom: 13, population: 3_800 },
  { id: 'virtsu', name: 'Virtsu', county: 'Pärnumaa', lat: 58.575, lng: 23.508, zoom: 13, population: 300 },
  // Viljandi
  { id: 'viljandi', name: 'Viljandi', county: 'Viljandimaa', lat: 58.363, lng: 25.596, zoom: 13, population: 16_000 },
  // Lääne-Viru
  { id: 'rakvere', name: 'Rakvere', county: 'Lääne-Virumaa', lat: 59.346, lng: 26.355, zoom: 13, population: 14_500 },
  { id: 'tapa', name: 'Tapa', county: 'Lääne-Virumaa', lat: 59.261, lng: 25.957, zoom: 13, population: 5_300 },
  // Saare
  { id: 'kuressaare', name: 'Kuressaare', county: 'Saaremaa', lat: 58.248, lng: 22.503, zoom: 13, population: 13_000 },
  // Lääne
  { id: 'haapsalu', name: 'Haapsalu', county: 'Läänemaa', lat: 58.943, lng: 23.541, zoom: 13, population: 9_500 },
  // Rapla
  { id: 'rapla', name: 'Rapla', county: 'Raplamaa', lat: 58.998, lng: 24.799, zoom: 13, population: 5_700 },
  // Järva
  { id: 'paide', name: 'Paide', county: 'Järvamaa', lat: 58.885, lng: 25.557, zoom: 13, population: 7_800 },
  { id: 'turi', name: 'Türi', county: 'Järvamaa', lat: 58.809, lng: 25.431, zoom: 13, population: 4_900 },
  // Jõgeva
  { id: 'jogeva', name: 'Jõgeva', county: 'Jõgevamaa', lat: 58.746, lng: 26.393, zoom: 13, population: 5_100 },
  { id: 'polva', name: 'Põltsamaa', county: 'Jõgevamaa', lat: 58.653, lng: 25.972, zoom: 13, population: 4_000 },
  // Põlva
  { id: 'polva-linn', name: 'Põlva', county: 'Põlvamaa', lat: 58.054, lng: 27.055, zoom: 13, population: 5_700 },
  // Valga
  { id: 'valga', name: 'Valga', county: 'Valgamaa', lat: 57.778, lng: 26.031, zoom: 13, population: 11_000 },
  // Võru
  { id: 'voru', name: 'Võru', county: 'Võrumaa', lat: 57.834, lng: 27.017, zoom: 13, population: 12_300 },
  // Hiiu
  { id: 'kardla', name: 'Kärdla', county: 'Hiiumaa', lat: 58.993, lng: 22.749, zoom: 13, population: 3_000 },
]

export const POLL_INTERVALS = {
  vehiclePositions: 7_000, // ms
  tripUpdates: 30_000,
  serviceAlerts: 60_000,
  delays: 20_000,
  stopBoard: 20_000, // matches the server-side cache TTL in /api/stop-board
  nearbyStops: 20_000, // matches the server-side cache TTL in /api/nearby-stops
  // Slower than delays' own 20s — detector readings only refresh ~5min
  // upstream (DETECTOR_CACHE_TTL) and TomTom flow is cached 10min
  // (CITY_FLOW_CACHE_TTL), so polling faster than this would just return
  // identical numbers.
  routeConditions: 60_000,
}

// Default search radius for "nearby stops" — enough to catch every platform
// at a busy city interchange without pulling in a second, unrelated stop
// cluster a few blocks over. Verified live against OTP's stopsByRadius: a
// small town like Rapla can have as few as 2 stops with any upcoming
// departure within this radius, so NEARBY_WIDE_RADIUS_M is a one-step
// fallback for exactly that case, not a general "keep expanding" search.
export const NEARBY_DEFAULT_RADIUS_M = 600
// Real Estonian countryside — not an artificial empty point, three actual
// rural spots sampled live (Harjumaa, Võrumaa, Läänemaa farmland) — commonly
// has its nearest stop 1-3km out; two of the three found literally nothing
// within 2km. 8km reliably surfaced 14-20 usable stops in all three, and
// OTP's own latency is unaffected by the larger radius (<130ms in every
// sample) — the walk itself, not the query, is the limiting factor out here.
export const NEARBY_WIDE_RADIUS_M = 8000
// Below this many usable stops at the default radius, retry once at the
// wide radius rather than showing a near-empty panel.
export const NEARBY_WIDEN_THRESHOLD = 3
export const NEARBY_MAX_STOPS = 8
// A single busy intersection can have several same-named stops for its
// different platforms/directions (verified live: central Tallinn returned
// 4x "Mere puiestee" and 3x "Viru" in the closest 8 — 7 of 8 slots for two
// physical locations). Capping how many same-named rows can appear keeps
// the panel showing a variety of nearby places instead of one interchange's
// every platform; the platforms themselves stay distinguishable by headsign.
export const NEARBY_MAX_PER_NAME = 2

// Stop-name search (the Departures tab / stop-only geocode) — see
// src/lib/stop-search.ts for the folding/ranking/clustering these gate.
// Same-named stops only merge into one dropdown row when within this of
// each other; verified live, "Lille" alone spans Tallinn/Tartu/Elva/
// Kuressaare/Kohila, tens of km apart, so this stays city-block-scale.
export const STOP_SEARCH_CLUSTER_RADIUS_M = 1_000
// How far a cluster can be from a known city and still be labelled with it
// in the dropdown ("Lille — Tallinn"); matches CITY_RELEVANCE_RADIUS_M's
// reasoning in page.tsx (any two of the top cities are 30km+ apart).
export const STOP_SEARCH_CITY_LABEL_RADIUS_M = 30_000
// Raised from the previous hard cap of 8 now that same-named stops in
// different towns are separate rows instead of one merged (and often
// mis-located) result — a common name can otherwise legitimately fill most
// of a smaller cap with entries for towns the rider has no interest in.
export const STOP_SEARCH_MAX_RESULTS = 10

// The From/To journey-planner search (unlike the Departures-tab stop-only
// search above) blends transit stops with plain street addresses. Stop
// results are computed first and always listed ahead of addresses, so
// without a reserved minimum a query matching 10+ stops (STOP_SEARCH_MAX_
// RESULTS's own internal cap) fills the combined list before any address is
// even considered — a rider typing a real street address would only ever
// see stop names. Reserving slots guarantees addresses stay reachable
// whenever the gazetteer actually returns any.
export const ADDRESS_SEARCH_RESERVED_RESULTS = 4

// Same reservation idea as ADDRESS_SEARCH_RESERVED_RESULTS, for OSM places
// (restaurants, gyms, shops — see src/lib/places-db.ts) merged into the same
// combined list. Kept smaller than the address reservation: an address
// search only ever runs when there's a real gazetteer hit worth protecting
// space for, while a place query can return many loosely-relevant category
// matches (e.g. every supermarket nationwide for "pood") that shouldn't be
// able to crowd out addresses just by being numerous.
export const PLACE_SEARCH_RESERVED_RESULTS = 3

// Same reservation idea again, for the Departures tab's own accommodation
// search (see /api/geocode's isStopSearch branch) — a tourist searching
// their hotel by name shouldn't have it crowded out by a query that also
// matches many stops nationwide.
export const ACCOMMODATION_SEARCH_RESERVED_RESULTS = 3

// Line-number search (mixed into the same Departures-tab search as stops
// above) — kept much smaller than STOP_SEARCH_MAX_RESULTS since a line query
// is almost always a short, specific code ("5", "T2", "R16") with very few
// real matches, unlike a place name that can legitimately have a dozen
// same-named stops across the country.
export const LINE_SEARCH_MAX_RESULTS = 5
// Same reasoning as STOP_SEARCH_CITY_LABEL_RADIUS_M — a line whose stops sit
// this far from every known city shows with no city label rather than a
// misleading one.
export const LINE_SEARCH_CITY_LABEL_RADIUS_M = 30_000

// Mapping from gps.txt type codes to our transport modes
// Verified against live feed: type 1 = trolleybus (lines terminate at Kopli/Kadriorg/
// Kaubamaja/Balti jaam, Tallinn's trolleybus depots), type 2 = bus (majority),
// type 3 = tram (lines 1-5). Type 7 = night bus, per the official field
// description published on Tallinn's open-data catalog entry for this feed
// (transport type 1-trolleybus, 2-bus, 3-tram, 7-night bus) — only runs late
// night/early morning, so it won't show in every live sample.
export const GPS_TYPE_MAP: Record<string, TransportMode> = {
  '1': 'trolleybus',
  '2': 'bus',
  '3': 'tram',
  '4': 'train',
  '5': 'ferry',
  '7': 'nightbus',
}

export const MODE_COLORS: Record<TransportMode, string> = {
  bus: '#4CAF50',
  tram: '#F44336',
  train: '#FF9800',
  ferry: '#9C27B0',
  trolleybus: '#00008B',
  nightbus: '#263238',
}

export const MODE_LABELS: Record<TransportMode, string> = {
  bus: 'Bus',
  tram: 'Tram',
  train: 'Train',
  ferry: 'Ferry',
  trolleybus: 'Trolleybus',
  nightbus: 'Night bus',
}

export const ALL_MODES: TransportMode[] = ['bus', 'tram', 'train', 'ferry', 'trolleybus', 'nightbus']

// How far a disruption/delayed/searched-for vehicle can be from a selected
// city (or a line search's own anchor stop) and still count as belonging to
// it — wide enough to cover a city's own fanned-out regional routes, tight
// enough that another city never bleeds in (any two of the top-15 cities are
// 30km+ apart, most far more). Without this, selecting Tartu still showed
// Tallinn's own delays/disruptions mixed in with Tartu's, right alongside
// every other city's — impossible to actually read; and picking a line
// number Tallinn also happens to run (e.g. "2") could match Tallinn's own bus
// out of the nationwide delay board instead of Tartu's, since a plain
// nearest-candidate search has nothing else to rule it out.
export const CITY_RELEVANCE_RADIUS_M = 30_000
