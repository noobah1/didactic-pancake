import { OTP_BASE_URL, OTP_FETCH_TIMEOUT_MS, STOP_SEARCH_CLUSTER_RADIUS_M, STOP_SEARCH_CITY_LABEL_RADIUS_M, STOP_SEARCH_MAX_RESULTS, CITIES } from '@/lib/constants'
import { foldName, tokenize, scoreName, clusterByLocation, nearestCityName, distanceToNearestActiveCity } from '@/lib/stop-search'
const TRANSIT_STOPS_QUERY = `
query {
  rail: routes(transportModes: [RAIL]) {
    patterns { stops { name lat lon gtfsId } }
  }
  ferry: routes(transportModes: [FERRY]) {
    patterns { stops { name lat lon gtfsId } }
  }
  bus: routes(transportModes: [BUS]) {
    patterns { stops { name lat lon gtfsId } }
  }
  tram: routes(transportModes: [TRAM]) {
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

interface GeoResult {
  name: string
  lat: number
  lng: number
  // Only present for an actual transit-stop match (not a plain address) —
  // the departure board needs OTP's stop id, an address has no such thing.
  stopId?: string
}

interface ActiveCity {
  lat: number
  lng: number
}

interface TransitStopsCache {
  train: Map<string, OtpStop[]>
  ferry: Map<string, OtpStop[]>
  bus: Map<string, OtpStop[]>
  tram: Map<string, OtpStop[]>
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
    for (const route of data.data?.rail || []) {
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) addStop(trainStops, stop)
      }
    }
    for (const route of data.data?.ferry || []) {
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) addStop(ferryStops, stop)
      }
    }
    for (const route of data.data?.bus || []) {
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) addStop(busStops, stop)
      }
    }
    for (const route of data.data?.tram || []) {
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) addStop(tramStops, stop)
      }
    }
    // Elron's schedule is loaded into the graph twice under different agency
    // ids — "1:" from the current, weekly-refreshed unified feed, "2:" from
    // the committed-once, never-refreshed elron.zip (see ELRON_AGENCY_GTFS_ID
    // in constants.ts). Its stop rows are exact duplicates of the "1:" ones,
    // same numeric id, just the stale feed's prefix — drop them here so they
    // never pad a merged stopId list with dead weight.
    const dropStaleFeedDuplicates = (map: Map<string, OtpStop[]>) => {
      for (const [key, stops] of map) {
        const primaryIds = new Set(stops.filter((s) => s.gtfsId.startsWith('1:')).map((s) => s.gtfsId.slice(2)))
        const deduped = stops.filter((s) => !(s.gtfsId.startsWith('2:') && primaryIds.has(s.gtfsId.slice(2))))
        map.set(key, deduped)
      }
    }
    for (const map of [trainStops, ferryStops, busStops, tramStops]) dropStaleFeedDuplicates(map)

    transitStopsCache = { train: trainStops, ferry: ferryStops, bus: busStops, tram: tramStops, timestamp: Date.now() }
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

const MODE_LABELS: { key: 'ferry' | 'train' | 'tram' | 'bus'; label: string }[] = [
  { key: 'ferry', label: 'Ferry terminal' },
  { key: 'train', label: 'Train station' },
  { key: 'tram', label: 'Tram stop' },
  { key: 'bus', label: 'Bus stop' },
]

async function searchTransitStops(query: string, activeCities: ActiveCity[] = []): Promise<GeoResult[]> {
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

  return results.slice(0, STOP_SEARCH_MAX_RESULTS).map((r) => ({ name: r.name, lat: r.lat, lng: r.lng, stopId: r.stopId }))
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')
  if (!query || query.length < 2) return Response.json({ results: [] })
  const activeCities = resolveActiveCities(searchParams)
  // The departure-board search only ever wants transit stops — an address
  // has no stopId to look departures up by. Skipping the gazetteer call
  // there also means it can't stall the response, unlike the general search.
  if (searchParams.get('type') === 'stop') {
    return Response.json({ results: await searchTransitStops(query, activeCities) })
  }
  const [stopsResults, addressResults] = await Promise.all([
    searchTransitStops(query, activeCities),
    searchEstonianAddresses(query),
  ])
  return Response.json({ results: [...stopsResults, ...addressResults].slice(0, STOP_SEARCH_MAX_RESULTS) })
}
