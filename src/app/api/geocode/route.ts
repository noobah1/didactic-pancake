import { NOMINATIM_URL, OTP_BASE_URL } from '@/lib/constants'

// Both branches below call third-party services (Nominatim, Maa-amet) that
// expect low request rates — rate-limit per client IP as a safety net beyond
// the 300ms client-side debounce, so a runaway client can't get this server
// banned from those services.
const RATE_LIMIT_WINDOW_MS = 10_000
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_MAX_BUCKETS = 10_000
const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>()

function isRateLimited(key: string): boolean {
  const now = Date.now()
  const bucket = rateLimitBuckets.get(key)
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    if (rateLimitBuckets.size >= RATE_LIMIT_MAX_BUCKETS) {
      for (const [k, b] of rateLimitBuckets) {
        if (now - b.windowStart >= RATE_LIMIT_WINDOW_MS) rateLimitBuckets.delete(k)
      }
    }
    rateLimitBuckets.set(key, { count: 1, windowStart: now })
    return false
  }
  bucket.count++
  return bucket.count > RATE_LIMIT_MAX
}

function getClientKey(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0].trim()
  return request.headers.get('x-real-ip') || 'unknown'
}
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

interface NominatimAddress {
  road?: string
  pedestrian?: string
  footway?: string
  suburb?: string
  house_number?: string
}

const reverseCache = new Map<string, { name: string; timestamp: number }>()
const REVERSE_CACHE_TTL = 300_000 // 5 min

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  // Round to ~10m so small GPS jitter reuses the cached name
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
  const hit = reverseCache.get(key)
  if (hit && Date.now() - hit.timestamp < REVERSE_CACHE_TTL) return hit.name

  try {
    const url = `${NOMINATIM_URL}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'LiveTravely/0.1 (github.com/noobah1/didactic-pancake)' },
    })
    if (!res.ok) return null
    const data: { address?: NominatimAddress; name?: string; display_name?: string } = await res.json()
    const a = data.address || {}
    const road = a.road || a.pedestrian || a.footway || a.suburb
    const name = road
      ? a.house_number ? `${road} ${a.house_number}` : road
      : data.name || data.display_name?.split(',')[0] || null

    if (name) reverseCache.set(key, { name, timestamp: Date.now() })
    return name
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  if (isRateLimited(getClientKey(request))) {
    return Response.json({ error: 'rate limited' }, { status: 429 })
  }

  // Reverse mode: coordinates -> place name
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')
  if (lat && lng) {
    const latNum = parseFloat(lat)
    const lngNum = parseFloat(lng)
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return Response.json({ error: 'invalid coordinates' }, { status: 400 })
    }
    const name = await reverseGeocode(latNum, lngNum)
    return Response.json({ name: name || 'My location' })
  }

  // Forward mode: text -> coordinates
  const query = searchParams.get('q')
  if (!query || query.length < 2) return Response.json({ results: [] })
  const [stopsResults, addressResults] = await Promise.all([searchTransitStops(query), searchEstonianAddresses(query)])
  return Response.json({ results: [...stopsResults, ...addressResults].slice(0, 8) })
}
