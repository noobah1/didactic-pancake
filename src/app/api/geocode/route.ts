import {
  OTP_BASE_URL,
  OTP_FETCH_TIMEOUT_MS,
  STOP_SEARCH_CLUSTER_RADIUS_M,
  STOP_SEARCH_CITY_LABEL_RADIUS_M,
  STOP_SEARCH_MAX_RESULTS,
  LINE_SEARCH_MAX_RESULTS,
  LINE_SEARCH_CITY_LABEL_RADIUS_M,
  CITIES,
} from '@/lib/constants'
import { foldName, tokenize, scoreName, clusterByLocation, nearestCityName, distanceToNearestActiveCity } from '@/lib/stop-search'
const TRANSIT_STOPS_QUERY = `
query {
  rail: routes(transportModes: [RAIL]) {
    shortName
    patterns { stops { name lat lon gtfsId } }
  }
  ferry: routes(transportModes: [FERRY]) {
    shortName
    patterns { stops { name lat lon gtfsId } }
  }
  bus: routes(transportModes: [BUS]) {
    shortName
    patterns { stops { name lat lon gtfsId } }
  }
  tram: routes(transportModes: [TRAM]) {
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
}

interface ActiveCity {
  lat: number
  lng: number
}

// A stop served by a line, plus that line's own shortName in its original
// casing — the lineStops maps below are keyed by *folded* shortName (so
// "t2" and "T2" land in the same bucket), which would otherwise lose the
// real display casing entirely.
interface LineStopEntry {
  shortName: string
  stop: OtpStop
}

interface TransitStopsCache {
  train: Map<string, OtpStop[]>
  ferry: Map<string, OtpStop[]>
  bus: Map<string, OtpStop[]>
  tram: Map<string, OtpStop[]>
  // Every stop served by a given line, keyed the same way the maps above key
  // stop names — used only to derive an anchor point per line for search-
  // result clustering/city-labeling (see searchTransitLines), not shown to
  // the rider directly.
  lineStops: {
    train: Map<string, LineStopEntry[]>
    ferry: Map<string, LineStopEntry[]>
    bus: Map<string, LineStopEntry[]>
    tram: Map<string, LineStopEntry[]>
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
    const trainLineStops = new Map<string, LineStopEntry[]>()
    const ferryLineStops = new Map<string, LineStopEntry[]>()
    const busLineStops = new Map<string, LineStopEntry[]>()
    const tramLineStops = new Map<string, LineStopEntry[]>()
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
    // Every stop a line serves, tagged under that line's own shortName — an
    // anchor set used only to cluster/city-label line search results (see
    // searchTransitLines), the same way the stop maps above cluster same-
    // named stops. A route with no shortName (rare, but present in the
    // graph for a couple of special/replacement services) contributes no
    // line-search entry at all rather than a blank, unsearchable one.
    const addLine = (map: Map<string, LineStopEntry[]>, route: OtpRoute) => {
      if (!route.shortName) return
      const key = foldName(route.shortName)
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) {
          const entry = { shortName: route.shortName, stop }
          const list = map.get(key)
          if (list) {
            if (!list.some((e) => e.stop.gtfsId === stop.gtfsId)) list.push(entry)
          } else {
            map.set(key, [entry])
          }
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
    // never pad a merged stopId list (or a line's anchor set) with dead
    // weight.
    const dropStaleFeedDuplicates = (map: Map<string, OtpStop[]>) => {
      for (const [key, stops] of map) {
        const primaryIds = new Set(stops.filter((s) => s.gtfsId.startsWith('1:')).map((s) => s.gtfsId.slice(2)))
        const deduped = stops.filter((s) => !(s.gtfsId.startsWith('2:') && primaryIds.has(s.gtfsId.slice(2))))
        map.set(key, deduped)
      }
    }
    for (const map of [trainStops, ferryStops, busStops, tramStops]) dropStaleFeedDuplicates(map)
    // Same duplicate-prefix problem, applied to the line-stops maps — same
    // underlying stop rows, just wrapped in a { shortName, stop } entry here.
    const dropStaleFeedDuplicatesFromLines = (map: Map<string, LineStopEntry[]>) => {
      for (const [key, entries] of map) {
        const primaryIds = new Set(
          entries.filter((e) => e.stop.gtfsId.startsWith('1:')).map((e) => e.stop.gtfsId.slice(2)),
        )
        const deduped = entries.filter(
          (e) => !(e.stop.gtfsId.startsWith('2:') && primaryIds.has(e.stop.gtfsId.slice(2))),
        )
        map.set(key, deduped)
      }
    }
    for (const map of [trainLineStops, ferryLineStops, busLineStops, tramLineStops]) {
      dropStaleFeedDuplicatesFromLines(map)
    }

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

const MODE_LABELS: { key: 'ferry' | 'train' | 'tram' | 'bus'; label: string }[] = [
  { key: 'ferry', label: 'Ferry terminal' },
  { key: 'train', label: 'Train station' },
  { key: 'tram', label: 'Tram stop' },
  { key: 'bus', label: 'Bus stop' },
]

const LINE_MODE_LABELS: { key: 'ferry' | 'train' | 'tram' | 'bus'; label: string }[] = [
  { key: 'ferry', label: 'Ferry' },
  { key: 'train', label: 'Train' },
  { key: 'tram', label: 'Tram' },
  { key: 'bus', label: 'Bus' },
]

async function searchTransitLines(query: string, activeCities: ActiveCity[] = []): Promise<GeoResult[]> {
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
  }
  const results: ScoredResult[] = []

  for (const { key, mode, score } of trimmed) {
    const entries = cache.lineStops[mode].get(key) || []
    if (entries.length === 0) continue
    const shortName = entries[0].shortName
    const modeLabel = LINE_MODE_LABELS.find((m) => m.key === mode)!.label

    // Group this line's own stops by nearest known city rather than
    // clustering nearby stops the way searchTransitStops does — a stop
    // name's clusters need to separate physically distinct poles a block
    // apart (STOP_SEARCH_CLUSTER_RADIUS_M), but a single line's own stops
    // legitimately span many kilometers within one town, so the right
    // grouping scale here is "same city", not "same block". Two different
    // towns' same-numbered line (Tallinn bus 5, Tartu bus 5) still end up as
    // separate rows since they resolve to different city labels.
    const byCity = new Map<string, OtpStop[]>()
    for (const { stop } of entries) {
      const cityLabel = nearestCityName(stop.lat, stop.lon, LINE_SEARCH_CITY_LABEL_RADIUS_M) ?? ''
      const list = byCity.get(cityLabel)
      if (list) list.push(stop)
      else byCity.set(cityLabel, [stop])
    }
    for (const [cityLabel, stops] of byCity) {
      const seed = stops[0]
      const displayName = cityLabel ? `Line ${shortName} (${modeLabel}) — ${cityLabel}` : `Line ${shortName} (${modeLabel})`
      results.push({
        name: displayName,
        lat: seed.lat,
        lng: seed.lon,
        line: shortName,
        mode,
        score,
        distanceToActive: distanceToNearestActiveCity(seed.lat, seed.lon, activeCities),
      })
    }
  }

  results.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    const da = a.distanceToActive ?? Infinity
    const db = b.distanceToActive ?? Infinity
    if (da !== db) return da - db
    return a.name.length - b.name.length
  })

  return results.slice(0, LINE_SEARCH_MAX_RESULTS).map((r) => ({ name: r.name, lat: r.lat, lng: r.lng, line: r.line, mode: r.mode }))
}

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
  // The departure-board search wants transit stops *and* lines — an address
  // has no stopId to look departures up by, and this is also the only
  // search surface a bare line code ("5", "T2", "R16") makes sense in (see
  // searchTransitLines; results merged in ahead of stops since a query that
  // exactly matches a line code is a strong, deliberate signal — no stop is
  // ever just named "5"). Skipping the gazetteer call here also means it
  // can't stall the response, unlike the general search below.
  if (isStopSearch) {
    const [lineResults, stopResults] = await Promise.all([
      searchTransitLines(query, activeCities),
      searchTransitStops(query, activeCities),
    ])
    return Response.json({ results: [...lineResults, ...stopResults] })
  }
  const [stopsResults, addressResults] = await Promise.all([
    searchTransitStops(query, activeCities),
    searchEstonianAddresses(query),
  ])
  return Response.json({ results: [...stopsResults, ...addressResults].slice(0, STOP_SEARCH_MAX_RESULTS) })
}
