import {
  OTP_BASE_URL,
  OTP_FETCH_TIMEOUT_MS,
  STOP_SEARCH_CLUSTER_RADIUS_M,
  STOP_SEARCH_CITY_LABEL_RADIUS_M,
  STOP_SEARCH_MAX_RESULTS,
  ADDRESS_SEARCH_RESERVED_RESULTS,
  PLACE_SEARCH_RESERVED_RESULTS,
  ACCOMMODATION_SEARCH_RESERVED_RESULTS,
  LINE_SEARCH_MAX_RESULTS,
  LINE_SEARCH_CITY_LABEL_RADIUS_M,
  CITIES,
} from '@/lib/constants'
import { foldName, tokenize, scoreName, clusterByLocation, nearestCityName, nearestCityPopulation, distanceToNearestActiveCity } from '@/lib/stop-search'
import { searchPlaces } from '@/lib/places-db'
import { placeCategoryBySlug, categoryLabel, ACCOMMODATION_CATEGORIES } from '@/lib/place-categories'

// Cache warming flag — set to true once the initial load completes, so
// simultaneous cache-miss requests don't all re-fetch from OTP
let isCacheWarming = false

const TRANSIT_STOPS_QUERY = `
query {
  rail: routes(transportModes: [RAIL]) {
    gtfsId
    shortName
    patterns { stops { name lat lon gtfsId } }
  }
  ferry: routes(transportModes: [FERRY]) {
    gtfsId
    shortName
    patterns { stops { name lat lon gtfsId } }
  }
  bus: routes(transportModes: [BUS]) {
    gtfsId
    shortName
    patterns { stops { name lat lon gtfsId } }
  }
  tram: routes(transportModes: [TRAM]) {
    gtfsId
    shortName
    patterns { stops { name lat lon gtfsId } }
  }
}
`

interface OtpStop {
  name: string
  lat: number
  lon: number
  gtfsId: string
}

interface OtpRoute {
  gtfsId: string
  shortName: string | null
  patterns: { stops: OtpStop[] }[]
}

interface GeoResult {
  name: string
  lat: number
  lng: number
  // Only present for an actual transit-stop match (not a plain address) —
  // the departure board needs OTP's stop id, an address has no such thing.
  stopId?: string
  // Only present for a line match — mutually exclusive with stopId. Selecting
  // one means "show this line", not "open a departure board".
  line?: string
  mode?: 'train' | 'ferry' | 'bus' | 'tram'
  // Only present for an OSM place match (restaurant, gym, shop — see
  // src/lib/places-db.ts) — mutually exclusive with stopId and line. The
  // category slug (e.g. 'gym'), for the client to pick an icon.
  placeCategory?: string
  // Rider-facing "Category · Address" line for a place result, already
  // localized server-side (see CATEGORY label lookups below) — e.g.
  // "Supermarket · Tartu mnt 12". Only present alongside placeCategory.
  placeDetail?: string
  // Raw OSM opening_hours spec, only present alongside placeCategory — left
  // unevaluated here and evaluated client-side (src/lib/opening-hours.ts)
  // against the rider's own clock rather than the server's, so a rider's
  // "open now" always matches the "now" they're looking at.
  openingHours?: string
  // Internal-only relevance signal, used by the general (stop + place +
  // address) search below to rank all three result kinds against each
  // other instead of always listing stops first — never sent to the client
  // (stripped before every Response.json in this file).
  score?: number
}

interface ActiveCity {
  lat: number
  lng: number
}

// One physical route's anchor for line search: its own shortName in
// original casing (the lineStops maps below are keyed by *folded* shortName,
// which would otherwise lose real display casing) and a single representative
// stop, used only to fly the map somewhere reasonable and to pick a city
// label — never shown to the rider directly.
interface LineAnchor {
  shortName: string
  stop: OtpStop
}

interface TransitStopsCache {
  train: Map<string, OtpStop[]>
  ferry: Map<string, OtpStop[]>
  bus: Map<string, OtpStop[]>
  tram: Map<string, OtpStop[]>
  // One entry per *distinct physical route*, keyed by folded shortName then
  // by that route's own gtfsId with any "N:" feed prefix stripped (route ids
  // carry the same per-feed prefix stop ids do — see the Elron dedup comment
  // below) — never by stop or by proximity. A single line's own stops
  // legitimately span many kilometers and can sit nearest several different
  // recognized cities along the route (confirmed live: R16 Tallinn-Riisipere
  // has stops nearest Tallinn, Keila, *and* Saue) — grouping by anything
  // geographic fragmented one line into several rows. Grouping by the
  // route's own identity is what actually answers "is this the same line",
  // and as a side effect handles Elron's duplicate-feed problem for free:
  // its "1:" and "2:" copies of the same route share the same de-prefixed
  // id, so they collapse into this same one entry rather than needing a
  // separate post-hoc dedup pass.
  lineStops: {
    train: Map<string, Map<string, LineAnchor>>
    ferry: Map<string, Map<string, LineAnchor>>
    bus: Map<string, Map<string, LineAnchor>>
    tram: Map<string, Map<string, LineAnchor>>
  }
  timestamp: number
}

let transitStopsCache: TransitStopsCache | null = null
let transitStopsRefresh: Promise<TransitStopsCache | null> | null = null
// Stop names/locations only change when the GTFS feed itself is rebuilt
// (an infra-triggered event, not something that happens mid-session), so
// this can be long. It used to be 10 minutes, which meant the first
// autocomplete keystroke after any 10-minute gap had to block on
// re-fetching every stop in the country before answering — the main
// source of "trip finding feels slow" complaints, since geocoding gates
// the search. Kept finite (not Infinity) so a stale cache still recovers
// on its own if the graph is ever reloaded without a server restart.
const TRANSIT_STOPS_CACHE_TTL = 6 * 60 * 60_000
// How long a cache entry can be served stale while a refresh happens in the
// background — keeps every request fast even right after TTL expiry.
const TRANSIT_STOPS_STALE_TTL = 24 * 60 * 60_000

async function fetchTransitStops() {
  try {
    const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: TRANSIT_STOPS_QUERY }),
      signal: AbortSignal.timeout(OTP_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return transitStopsCache
    const data = await response.json()
    const trainStops = new Map<string, OtpStop[]>()
    const ferryStops = new Map<string, OtpStop[]>()
    const busStops = new Map<string, OtpStop[]>()
    const tramStops = new Map<string, OtpStop[]>()
    const trainLineStops = new Map<string, Map<string, LineAnchor>>()
    const ferryLineStops = new Map<string, Map<string, LineAnchor>>()
    const busLineStops = new Map<string, Map<string, LineAnchor>>()
    const tramLineStops = new Map<string, Map<string, LineAnchor>>()
    // A name can belong to several distinct physical stops (separate poles
    // on either side of a road, several bus bays at an interchange) — collect
    // all of them per name instead of the previous Map<name, single stop>,
    // which silently kept only the last one seen and dropped the rest.
    // Keyed by folded name (diacritics stripped) rather than raw lowercase,
    // so a query typed without ä/ö/ü/õ/š/ž still lands on the right bucket —
    // see foldName in stop-search.ts for why that matters (~30% of stop
    // names carry one of these).
    const addStop = (map: Map<string, OtpStop[]>, stop: OtpStop) => {
      const key = foldName(stop.name)
      const list = map.get(key)
      if (list) {
        if (!list.some((s) => s.gtfsId === stop.gtfsId)) list.push(stop)
      } else {
        map.set(key, [stop])
      }
    }
    // One anchor per distinct physical route, tagged under that line's own
    // shortName (see the lineStops field comment on TransitStopsCache for why
    // this groups by route identity rather than by stop or proximity). A
    // route with no shortName (rare, but present in the graph for a couple
    // of special/replacement services) contributes no line-search entry at
    // all rather than a blank, unsearchable one.
    const addLine = (map: Map<string, Map<string, LineAnchor>>, route: OtpRoute) => {
      if (!route.shortName) return
      const key = foldName(route.shortName)
      // OTP ids are always "<feed-digit>:<rest>" — stripping that prefix is
      // what makes Elron's "1:" (current feed) and "2:" (stale elron.zip
      // copy — see ELRON_AGENCY_GTFS_ID in constants.ts) entries for the
      // same physical route collapse onto the same routeKey automatically.
      const routeKey = route.gtfsId.slice(2)
      let byRoute = map.get(key)
      if (!byRoute) {
        byRoute = new Map()
        map.set(key, byRoute)
      }
      if (byRoute.has(routeKey)) return
      for (const pattern of route.patterns) {
        if (pattern.stops.length > 0) {
          byRoute.set(routeKey, { shortName: route.shortName, stop: pattern.stops[0] })
          return
        }
      }
    }
    for (const route of (data.data?.rail || []) as OtpRoute[]) {
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) addStop(trainStops, stop)
      }
      addLine(trainLineStops, route)
    }
    for (const route of (data.data?.ferry || []) as OtpRoute[]) {
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) addStop(ferryStops, stop)
      }
      addLine(ferryLineStops, route)
    }
    for (const route of (data.data?.bus || []) as OtpRoute[]) {
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) addStop(busStops, stop)
      }
      addLine(busLineStops, route)
    }
    for (const route of (data.data?.tram || []) as OtpRoute[]) {
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) addStop(tramStops, stop)
      }
      addLine(tramLineStops, route)
    }
    // Elron's schedule is loaded into the graph twice under different agency
    // ids — "1:" from the current, weekly-refreshed unified feed, "2:" from
    // the committed-once, never-refreshed elron.zip (see ELRON_AGENCY_GTFS_ID
    // in constants.ts). Its stop rows are exact duplicates of the "1:" ones,
    // same numeric id, just the stale feed's prefix — drop them here so they
    // never pad a merged stopId list with dead weight. (The lineStops maps
    // don't need this same treatment — addLine already collapses both
    // copies of a duplicated route onto one anchor by de-prefixed route id;
    // see its own comment.)
    const dropStaleFeedDuplicates = (map: Map<string, OtpStop[]>) => {
      for (const [key, stops] of map) {
        const primaryIds = new Set(stops.filter((s) => s.gtfsId.startsWith('1:')).map((s) => s.gtfsId.slice(2)))
        const deduped = stops.filter((s) => !(s.gtfsId.startsWith('2:') && primaryIds.has(s.gtfsId.slice(2))))
        map.set(key, deduped)
      }
    }
    for (const map of [trainStops, ferryStops, busStops, tramStops]) dropStaleFeedDuplicates(map)

    transitStopsCache = {
      train: trainStops,
      ferry: ferryStops,
      bus: busStops,
      tram: tramStops,
      lineStops: { train: trainLineStops, ferry: ferryLineStops, bus: busLineStops, tram: tramLineStops },
      timestamp: Date.now(),
    }
    return transitStopsCache
  } catch {
    return transitStopsCache
  }
}

async function loadTransitStops() {
  const now = Date.now()
  const age = transitStopsCache ? now - transitStopsCache.timestamp : Infinity

  if (age < TRANSIT_STOPS_CACHE_TTL) {
    return transitStopsCache
  }

  // Dedup concurrent refreshes — several autocomplete requests can land
  // while one refresh is already in flight.
  if (!transitStopsRefresh) {
    transitStopsRefresh = fetchTransitStops().finally(() => {
      transitStopsRefresh = null
    })
  }

  // Cache merely expired (not yet stale-expired): serve the last known-good
  // result immediately and let the refresh above finish in the background,
  // so this request never pays for the nationwide re-fetch.
  if (age < TRANSIT_STOPS_STALE_TTL) {
    return transitStopsCache
  }

  // No usable cache at all (cold start, or stale past the point of trusting
  // it) — this request has to wait for a real answer.
  return transitStopsRefresh
}

// Rider-facing labels baked into the display strings this route returns
// (e.g. "Lille (Bus/Tram) — Tallinn", "Line 5 (Bus)") — kept here rather
// than pulled from the shared i18n dictionaries since this is a server
// route with no React context, and the set of labels is tiny and stable.
// `lang` comes straight from the client's current locale (see
// useGeocode's `lang` param), defaulting to 'et' to match the app's own
// default locale.
type GeocodeLang = 'en' | 'et' | 'ru'

const MODE_LABELS_BY_LANG: Record<GeocodeLang, { key: 'ferry' | 'train' | 'tram' | 'bus'; label: string }[]> = {
  en: [
    { key: 'ferry', label: 'Ferry terminal' },
    { key: 'train', label: 'Train station' },
    { key: 'tram', label: 'Tram stop' },
    { key: 'bus', label: 'Bus stop' },
  ],
  et: [
    { key: 'ferry', label: 'Parvlaevaterminal' },
    { key: 'train', label: 'Raudteejaam' },
    { key: 'tram', label: 'Trammipeatus' },
    { key: 'bus', label: 'Bussipeatus' },
  ],
  ru: [
    { key: 'ferry', label: 'Паромный терминал' },
    { key: 'train', label: 'Железнодорожная станция' },
    { key: 'tram', label: 'Трамвайная остановка' },
    { key: 'bus', label: 'Автобусная остановка' },
  ],
}

const LINE_MODE_LABELS_BY_LANG: Record<GeocodeLang, { key: 'ferry' | 'train' | 'tram' | 'bus'; label: string }[]> = {
  en: [
    { key: 'ferry', label: 'Ferry' },
    { key: 'train', label: 'Train' },
    { key: 'tram', label: 'Tram' },
    { key: 'bus', label: 'Bus' },
  ],
  et: [
    { key: 'ferry', label: 'Parvlaev' },
    { key: 'train', label: 'Rong' },
    { key: 'tram', label: 'Tramm' },
    { key: 'bus', label: 'Buss' },
  ],
  ru: [
    { key: 'ferry', label: 'Паром' },
    { key: 'train', label: 'Поезд' },
    { key: 'tram', label: 'Трамвай' },
    { key: 'bus', label: 'Автобус' },
  ],
}

const LINE_WORD_BY_LANG: Record<GeocodeLang, string> = {
  en: 'Line',
  et: 'Liin',
  ru: 'Маршрут',
}

function resolveGeocodeLang(value: string | null): GeocodeLang {
  return value === 'en' || value === 'ru' ? value : 'et'
}

async function searchTransitLines(query: string, activeCities: ActiveCity[] = [], lang: GeocodeLang = 'et'): Promise<GeoResult[]> {
  const LINE_MODE_LABELS = LINE_MODE_LABELS_BY_LANG[lang]
  const cache = await loadTransitStops()
  if (!cache) return []
  const foldedQuery = foldName(query)
  if (!foldedQuery) return []
  const tokens = tokenize(query)

  // Score once per distinct (folded shortName, mode) pair — relevance is a
  // property of the line code itself, same principle searchTransitStops
  // uses for stop names.
  const candidates: { key: string; mode: (typeof LINE_MODE_LABELS)[number]['key']; score: number }[] = []
  for (const { key: mode } of LINE_MODE_LABELS) {
    for (const foldedShortName of cache.lineStops[mode].keys()) {
      const score = scoreName(foldedShortName, foldedQuery, tokens)
      if (score > 0) candidates.push({ key: foldedShortName, mode, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  // Kept well above LINE_SEARCH_MAX_RESULTS since one line code can still
  // split into several city-specific rows below.
  const trimmed = candidates.slice(0, LINE_SEARCH_MAX_RESULTS * 4)

  interface ScoredResult extends GeoResult {
    score: number
    distanceToActive: number | null
    // Nearest recognized city's population (0 if none within
    // LINE_SEARCH_CITY_LABEL_RADIUS_M) — see the tie-break comment below for
    // why this exists.
    population: number
  }
  const results: ScoredResult[] = []

  for (const { key, mode, score } of trimmed) {
    const byRoute = cache.lineStops[mode].get(key)
    if (!byRoute || byRoute.size === 0) continue
    const modeLabel = LINE_MODE_LABELS.find((m) => m.key === mode)!.label

    // One row per distinct physical route (byRoute is already deduped at
    // that grain — see the lineStops field comment on TransitStopsCache),
    // each labeled by its own anchor stop's nearest city. Two different
    // towns' same-numbered line (Tallinn bus 5, Tartu bus 5) are genuinely
    // separate routes and so naturally end up as separate rows; one route
    // whose stops merely pass near several recognized cities (a regional
    // train) stays a single row, labeled from wherever its own anchor stop
    // happens to be.
    for (const { shortName, stop } of byRoute.values()) {
      const cityLabel = nearestCityName(stop.lat, stop.lon, LINE_SEARCH_CITY_LABEL_RADIUS_M)
      const lineWord = LINE_WORD_BY_LANG[lang]
      const displayName = cityLabel ? `${lineWord} ${shortName} (${modeLabel}) — ${cityLabel}` : `${lineWord} ${shortName} (${modeLabel})`
      results.push({
        name: displayName,
        lat: stop.lat,
        lng: stop.lon,
        line: shortName,
        mode,
        score,
        distanceToActive: distanceToNearestActiveCity(stop.lat, stop.lon, activeCities),
        population: nearestCityPopulation(stop.lat, stop.lon, LINE_SEARCH_CITY_LABEL_RADIUS_M),
      })
    }
  }

  results.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    // A same-numbered line exists in a dozen-plus towns nationwide (bus "5"
    // alone runs in ~8) — with only LINE_SEARCH_MAX_RESULTS slots, breaking
    // ties by raw distance-from-active-city buried major cities like Tartu
    // (Estonia's second largest) behind every small town that merely sits
    // closer to Tallinn, the app's default active city. A match actually in
    // one of the rider's selected cities still wins outright; beyond that,
    // rank by the matching town's size rather than its distance from
    // wherever the rider happens to be centered.
    const da = a.distanceToActive ?? Infinity
    const db = b.distanceToActive ?? Infinity
    const aInActive = da <= LINE_SEARCH_CITY_LABEL_RADIUS_M
    const bInActive = db <= LINE_SEARCH_CITY_LABEL_RADIUS_M
    if (aInActive !== bInActive) return aInActive ? -1 : 1
    if (a.population !== b.population) return b.population - a.population
    if (da !== db) return da - db
    return a.name.length - b.name.length
  })

  return results.slice(0, LINE_SEARCH_MAX_RESULTS).map((r) => ({ name: r.name, lat: r.lat, lng: r.lng, line: r.line, mode: r.mode }))
}

async function searchTransitStops(query: string, activeCities: ActiveCity[] = [], lang: GeocodeLang = 'et'): Promise<GeoResult[]> {
  const MODE_LABELS = MODE_LABELS_BY_LANG[lang]
  const cache = await loadTransitStops()
  if (!cache) return []
  const foldedQuery = foldName(query)
  if (!foldedQuery) return []
  const tokens = tokenize(query)

  // Score once per distinct (folded) name rather than per physical stop —
  // relevance ("Lille" outranks "Lilleküla") is a property of the name, and
  // every stop sharing that name inherits its score. This also fixes
  // multi-word queries like "Lille peatus", which the previous whole-string
  // `includes(q)` check matched against nothing.
  const candidateNames = new Set<string>()
  for (const { key } of MODE_LABELS) {
    for (const name of cache[key].keys()) candidateNames.add(name)
  }
  const scoredNames = Array.from(candidateNames)
    .map((name) => ({ name, score: scoreName(name, foldedQuery, tokens) }))
    .filter((n) => n.score > 0)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
    // A name can split into several city-specific rows once clustered below,
    // so keep well more candidate names than the final result cap — otherwise
    // a common name could crowd out a lower-ranked but still relevant one.
    .slice(0, STOP_SEARCH_MAX_RESULTS * 4)

  interface ScoredResult extends GeoResult {
    score: number
    distanceToActive: number | null
  }
  const results: ScoredResult[] = []

  for (const { name, score } of scoredNames) {
    // Different modes can share the exact same name at the exact same place
    // (a tram platform and a bus bay both called "Hobujaama") — tag each
    // stop with which mode found it before clustering, so stops that turn
    // out to be different physical locations don't merge mode labels that
    // don't belong to them.
    const tagged: (OtpStop & { modeKey: (typeof MODE_LABELS)[number]['key'] })[] = []
    for (const { key } of MODE_LABELS) {
      for (const stop of cache[key].get(name) || []) tagged.push({ ...stop, modeKey: key })
    }
    if (tagged.length === 0) continue

    // Same name, different towns (verified live: "Lille" alone spans
    // Tallinn/Tartu/Elva/Kuressaare/Kohila) must never merge into one
    // result — that previously produced a single stopId list whose lat/lng
    // was an arbitrary member's, flying the map to the wrong city entirely.
    const clusters = clusterByLocation(tagged, STOP_SEARCH_CLUSTER_RADIUS_M)
    for (const cluster of clusters) {
      const labels = MODE_LABELS.filter((m) => cluster.some((s) => s.modeKey === m.key)).map((m) => m.label)
      const seed = cluster[0]
      const cityLabel = nearestCityName(seed.lat, seed.lon, STOP_SEARCH_CITY_LABEL_RADIUS_M)
      const displayName = cityLabel ? `${seed.name} (${labels.join('/')}) — ${cityLabel}` : `${seed.name} (${labels.join('/')})`
      results.push({
        name: displayName,
        lat: seed.lat,
        lng: seed.lon,
        stopId: cluster.map((s) => s.gtfsId).join(','),
        score,
        distanceToActive: distanceToNearestActiveCity(seed.lat, seed.lon, activeCities),
      })
    }
  }

  // Relevance first; among equally relevant matches (e.g. two exact-name
  // hits in different towns), prefer whichever is nearer the rider's
  // currently-selected city — so a Tallinn rider searching a name that also
  // exists in five other towns sees Tallinn's first.
  results.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    const da = a.distanceToActive ?? Infinity
    const db = b.distanceToActive ?? Infinity
    if (da !== db) return da - db
    return a.name.length - b.name.length
  })

  // score is kept (not stripped here) so the general search below can rank
  // stops against addresses; the stopsOnly (departure-board) response strips
  // it itself before sending, since a rider-facing payload has no use for it.
  return results.slice(0, STOP_SEARCH_MAX_RESULTS).map((r) => ({ name: r.name, lat: r.lat, lng: r.lng, stopId: r.stopId, score: r.score }))
}

async function searchEstonianAddresses(query: string): Promise<GeoResult[]> {
  try {
    const url = 'https://inaadress.maaamet.ee/inaadress/gazetteer?address=' + encodeURIComponent(query) + '&results=8&lang=et'
    // Bounded so a slow external gazetteer can't stall the whole
    // autocomplete response — transit stop results still come back on time.
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return []
    const data = await res.json()
    return (data.addresses || [])
      .map((item: { ipikkaadress?: string; viitepunkt_b?: string; viitepunkt_l?: string }) => ({ name: item.ipikkaadress || query, lat: parseFloat(item.viitepunkt_b || '0'), lng: parseFloat(item.viitepunkt_l || '0') }))
      .filter((r: { lat: number; lng: number }) => r.lat > 57.5 && r.lat < 60 && r.lng > 21 && r.lng < 28)
  } catch { return [] }
}

// OSM places (restaurants, gyms, pharmacies, shops — see
// src/lib/places-db.ts) — the third source merged into the general search
// below, alongside transit stops and street addresses. Synchronous (SQLite
// is a local file, not a network call) so this needs no timeout/abort
// handling of its own, and searchPlaces already never throws (a missing or
// corrupt places.db resolves to an empty array there, not here) — this
// wrapper exists only to turn a PlaceResult into this route's own GeoResult
// shape and localize its category label.
function searchOsmPlaces(query: string, activeCities: ActiveCity[], lang: GeocodeLang, categories?: string[]): GeoResult[] {
  const places = searchPlaces(query, { limit: STOP_SEARCH_MAX_RESULTS, activeCities, now: new Date(), categories })
  return places.map((p) => {
    const category = placeCategoryBySlug(p.category)
    const label = category ? categoryLabel(category, lang) : p.category
    const detail = [label, p.addr || p.city].filter(Boolean).join(' · ')
    return {
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      placeCategory: p.category,
      placeDetail: detail,
      openingHours: p.openingHours ?? undefined,
      score: p.score,
    }
  })
}

// Same "all selected (or none) = no filter" convention page.tsx already uses
// for delays/alerts (see its showAllCities) — otherwise selecting every city
// would bias results toward whichever candidate is nearest ANY town, which
// isn't really "no bias" but reads as one.
function resolveActiveCities(searchParams: URLSearchParams): ActiveCity[] {
  const citiesParam = searchParams.get('cities')
  if (!citiesParam) return []
  const ids = new Set(citiesParam.split(',').filter(Boolean))
  if (ids.size === 0 || ids.size >= CITIES.length) return []
  return CITIES.filter((c) => ids.has(c.id)).map((c) => ({ lat: c.lat, lng: c.lng }))
}

// Warm the cache on app start — run in the background so requests never block
// on the nationwide transit-stops query. This endpoint is hit on app load by
// the LocationInput components in SearchPanel, which otherwise would stall
// the UI while fetching all stops from OTP.
async function warmCache() {
  if (isCacheWarming) return
  isCacheWarming = true
  try {
    await loadTransitStops()
  } catch {
    // Failure is non-critical — the cache will just miss and load on first request
  } finally {
    isCacheWarming = false
  }
}
// Kick off cache warming immediately on module load, without waiting
warmCache()

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')
  const isStopSearch = searchParams.get('type') === 'stop'
  // The general (address-included) search needs at least 2 characters —
  // below that, a place-name search is too broad to be useful and would
  // otherwise dispatch a query to the external gazetteer for every single
  // keystroke. The departure-board search allows a single character since a
  // one-digit line code ("1", "2", "5"...) is an extremely common, complete,
  // deliberate query on its own — requiring 2 would make the single most
  // common class of line search unreachable.
  if (!query || query.length < (isStopSearch ? 1 : 2)) return Response.json({ results: [] })
  const activeCities = resolveActiveCities(searchParams)
  const lang = resolveGeocodeLang(searchParams.get('lang'))
  // The departure-board search wants transit stops *and* lines — an address
  // has no stopId to look departures up by, and this is also the only
  // search surface a bare line code ("5", "T2", "R16") makes sense in (see
  // searchTransitLines; results kept ahead of stops+places since a query
  // that exactly matches a line code is a strong, deliberate signal — no
  // stop is ever just named "5"). Skipping the gazetteer call here also
  // means it can't stall the response, unlike the general search below.
  //
  // Also merges in accommodation (hotel/hostel/guest_house/apartment/motel —
  // see ACCOMMODATION_CATEGORIES) so a tourist can find departures near
  // their hotel by name without first knowing which stop is nearby. Kept to
  // this narrow category subset — unlike the general search's full place
  // search — because this tab is a departure-board finder, not a POI
  // browser: letting every restaurant/shop match in here would bury the
  // stop and line results a departure search is actually for. Only run once
  // the query is 2+ characters (like the general search), since a 1-char
  // FTS prefix match against every accommodation nationwide isn't a
  // deliberate query the way a 1-digit line code is.
  if (isStopSearch) {
    const [lineResults, stopResults] = await Promise.all([
      searchTransitLines(query, activeCities, lang),
      searchTransitStops(query, activeCities, lang),
    ])
    const accommodationResults = query.length >= 2
      ? searchOsmPlaces(query, activeCities, lang, ACCOMMODATION_CATEGORIES)
      : []
    // Stops and accommodation share one relevance scale (both carry `score`
    // — see GeoResult) and are merged the same way the general search below
    // merges stops/places/addresses: sorted by score with a kind tie-break,
    // and a reserved minimum so a query matching many stops can't shut
    // accommodation out entirely. Lines are exempt from all of this — an
    // exact line-code match stays first, unconditionally.
    const reservedForAccommodation = Math.min(accommodationResults.length, ACCOMMODATION_SEARCH_RESERVED_RESULTS)
    const stopsCapped = stopResults.slice(0, STOP_SEARCH_MAX_RESULTS - reservedForAccommodation)
    const withKind = [
      ...stopsCapped.map((r) => ({ ...r, kind: 0 })),
      ...accommodationResults.map((r) => ({ ...r, kind: 1 })),
    ]
    const mergedStopsAndPlaces = withKind
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.kind - b.kind)
      .slice(0, STOP_SEARCH_MAX_RESULTS)
    // score is internal ranking state (see GeoResult) — not meaningful to
    // the client, so strip it same as every other outgoing response does.
    const results = [...lineResults, ...mergedStopsAndPlaces].map(({ name, lat, lng, stopId, line, mode, placeCategory, placeDetail, openingHours }) => ({ name, lat, lng, stopId, line, mode, placeCategory, placeDetail, openingHours }))
    return Response.json({ results })
  }
  const [stopsResults, addressResults] = await Promise.all([
    searchTransitStops(query, activeCities, lang),
    searchEstonianAddresses(query),
  ])
  // Synchronous (local SQLite, not a network call — see searchOsmPlaces),
  // so it doesn't join the Promise.all above; nothing else is waiting on it.
  const placeResults = searchOsmPlaces(query, activeCities, lang)
  // Addresses have no relevance score of their own (the external gazetteer
  // just returns its own best-guess order), so score them the same way stop
  // names are scored, against the same query — this is what lets the merge
  // below rank a strong address match above a weak stop match instead of
  // always listing every stop first regardless of fit. A folded/tokenized
  // match of 0 doesn't mean "irrelevant" here the way it does for stops —
  // the gazetteer already decided this address is a real match (e.g. a
  // house-number query like "5" won't textually appear in "Narva mnt 5A")
  // — so it's floored at 1 rather than dropped, only ranking below anything
  // that does score on text.
  const foldedQuery = foldName(query)
  const tokens = tokenize(query)
  const scoredAddresses = addressResults.map((r) => ({ ...r, score: Math.max(scoreName(foldName(r.name), foldedQuery, tokens), 1) }))
  // Stops are still capped below the full result count — see
  // ADDRESS_SEARCH_RESERVED_RESULTS/PLACE_SEARCH_RESERVED_RESULTS — so a
  // query matching 10+ stops can't shut places/addresses out before the
  // relevance sort below even runs; within that budget, ranking now decides
  // order and which of each make the cut.
  const reservedForAddresses = Math.min(addressResults.length, ADDRESS_SEARCH_RESERVED_RESULTS)
  const reservedForPlaces = Math.min(placeResults.length, PLACE_SEARCH_RESERVED_RESULTS)
  const stopsCapped = stopsResults.slice(0, STOP_SEARCH_MAX_RESULTS - reservedForAddresses - reservedForPlaces)
  // Kind priority is the tie-break when two candidates score exactly the
  // same (e.g. an exact-name match on both a stop and an unrelated address)
  // — a transit stop is the most likely intent for a transit app, an OSM
  // place beats a bare address next. "Balti jaam" must still resolve to the
  // station itself even if some address happens to score identically.
  const withKind = [
    ...stopsCapped.map((r) => ({ ...r, kind: 0 })),
    ...placeResults.map((r) => ({ ...r, kind: 1 })),
    ...scoredAddresses.map((r) => ({ ...r, kind: 2 })),
  ]
  const merged = withKind
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.kind - b.kind)
    .slice(0, STOP_SEARCH_MAX_RESULTS)
    .map(({ name, lat, lng, stopId, placeCategory, placeDetail, openingHours }) => ({ name, lat, lng, stopId, placeCategory, placeDetail, openingHours }))
  return Response.json({ results: merged })
}
