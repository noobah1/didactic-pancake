import { OTP_BASE_URL } from '@/lib/constants'
const TRANSIT_STOPS_QUERY = `
query {
  rail: routes(transportModes: [RAIL]) {
    patterns { stops { name lat lon } }
  }
  ferry: routes(transportModes: [FERRY]) {
    patterns { stops { name lat lon } }
  }
  bus: routes(transportModes: [BUS]) {
    patterns { stops { name lat lon } }
  }
  tram: routes(transportModes: [TRAM]) {
    patterns { stops { name lat lon } }
  }
}
`

interface OtpStop {
  name: string
  lat: number
  lon: number
}

interface GeoResult {
  name: string
  lat: number
  lng: number
}

let transitStopsCache: { train: Map<string, OtpStop>; ferry: Map<string, OtpStop>; bus: Map<string, OtpStop>; tram: Map<string, OtpStop>; timestamp: number } | null = null
const TRANSIT_STOPS_CACHE_TTL = 600_000

async function loadTransitStops() {
  const now = Date.now()
  if (transitStopsCache && now - transitStopsCache.timestamp < TRANSIT_STOPS_CACHE_TTL) {
    return transitStopsCache
  }
  try {
    const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: TRANSIT_STOPS_QUERY }),
    })
    if (!response.ok) return transitStopsCache
    const data = await response.json()
    const trainStops = new Map<string, OtpStop>()
    const ferryStops = new Map<string, OtpStop>()
    const busStops = new Map<string, OtpStop>()
    const tramStops = new Map<string, OtpStop>()
    for (const route of data.data?.rail || []) {
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) trainStops.set(stop.name.toLowerCase(), stop)
      }
    }
    for (const route of data.data?.ferry || []) {
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) ferryStops.set(stop.name.toLowerCase(), stop)
      }
    }
    for (const route of data.data?.bus || []) {
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) busStops.set(stop.name.toLowerCase(), stop)
      }
    }
    for (const route of data.data?.tram || []) {
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) tramStops.set(stop.name.toLowerCase(), stop)
      }
    }
    transitStopsCache = { train: trainStops, ferry: ferryStops, bus: busStops, tram: tramStops, timestamp: now }
    return transitStopsCache
  } catch {
    return transitStopsCache
  }
}

async function searchTransitStops(query: string): Promise<GeoResult[]> {
  const cache = await loadTransitStops()
  if (!cache) return []
  const q = query.toLowerCase()
  const results: GeoResult[] = []
  const seen = new Set<string>()

  const add = (stop: OtpStop, label: string) => {
    if (!seen.has(stop.name)) {
      seen.add(stop.name)
      results.push({ name: `${stop.name} (${label})`, lat: stop.lat, lng: stop.lon })
    }
  }

  for (const [name, stop] of cache.ferry) {
    if (name.includes(q)) add(stop, 'Ferry terminal')
  }
  for (const [name, stop] of cache.train) {
    if (name.includes(q)) add(stop, 'Train station')
  }
  for (const [name, stop] of cache.tram) {
    if (name.includes(q)) add(stop, 'Tram stop')
  }
  for (const [name, stop] of cache.bus) {
    if (name.includes(q)) add(stop, 'Bus stop')
  }

  return results.slice(0, 5)
}
async function searchEstonianAddresses(query: string): Promise<GeoResult[]> {
  try {
    const url = 'https://inaadress.maaamet.ee/inaadress/gazetteer?address=' + encodeURIComponent(query) + '&results=8&lang=et'
    const res = await fetch(url)
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
  const [stopsResults, addressResults] = await Promise.all([searchTransitStops(query), searchEstonianAddresses(query)])
  return Response.json({ results: [...stopsResults, ...addressResults].slice(0, 8) })
}
