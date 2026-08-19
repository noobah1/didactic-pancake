import { OTP_BASE_URL, OTP_FETCH_TIMEOUT_MS } from '@/lib/constants'
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
    const addStop = (map: Map<string, OtpStop[]>, stop: OtpStop) => {
      const key = stop.name.toLowerCase()
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

async function searchTransitStops(query: string): Promise<GeoResult[]> {
  const cache = await loadTransitStops()
  if (!cache) return []
  const q = query.toLowerCase()

  // A name match can be satisfied by several physical stops — different
  // modes at the same name (a tram platform and a bus bay both called
  // "Hobujaama"), or several poles of the same mode. All of them get
  // merged into one search result carrying every matching stopId, so the
  // departure board below can show the full picture instead of whichever
  // single platform happened to win a mode-priority tiebreak.
  const matchedNames: string[] = []
  const seenNames = new Set<string>()
  for (const { key } of MODE_LABELS) {
    for (const name of cache[key].keys()) {
      if (name.includes(q) && !seenNames.has(name)) {
        seenNames.add(name)
        matchedNames.push(name)
      }
    }
  }

  const results: GeoResult[] = []
  for (const name of matchedNames) {
    const stopIds: string[] = []
    const labels: string[] = []
    let displayName = ''
    let lat = 0
    let lng = 0
    for (const { key, label } of MODE_LABELS) {
      const stops = cache[key].get(name)
      if (!stops || stops.length === 0) continue
      labels.push(label)
      for (const stop of stops) {
        stopIds.push(stop.gtfsId)
        if (!displayName) {
          displayName = stop.name
          lat = stop.lat
          lng = stop.lon
        }
      }
    }
    if (stopIds.length === 0) continue
    results.push({ name: `${displayName} (${labels.join('/')})`, lat, lng, stopId: stopIds.join(',') })
  }

  return results.slice(0, 8)
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')
  if (!query || query.length < 2) return Response.json({ results: [] })
  // The departure-board search only ever wants transit stops — an address
  // has no stopId to look departures up by. Skipping the gazetteer call
  // there also means it can't stall the response, unlike the general search.
  if (searchParams.get('type') === 'stop') {
    return Response.json({ results: (await searchTransitStops(query)).slice(0, 8) })
  }
  const [stopsResults, addressResults] = await Promise.all([searchTransitStops(query), searchEstonianAddresses(query)])
  return Response.json({ results: [...stopsResults, ...addressResults].slice(0, 8) })
}
