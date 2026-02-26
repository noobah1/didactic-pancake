import { NextResponse } from 'next/server'
import { NOMINATIM_URL, OTP_BASE_URL } from '@/lib/constants'

// Query all stops served by rail/ferry routes to find train stations and ferry terminals
const TRANSIT_STOPS_QUERY = `
query {
  rail: routes(transportModes: [RAIL]) {
    patterns {
      stops { name lat lon }
    }
  }
  ferry: routes(transportModes: [FERRY]) {
    patterns {
      stops { name lat lon }
    }
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

// Cache rail/ferry stops (they don't change often)
let transitStopsCache: { train: Map<string, OtpStop>; ferry: Map<string, OtpStop>; timestamp: number } | null = null
const TRANSIT_STOPS_CACHE_TTL = 600_000 // 10 minutes

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

    for (const route of data.data?.rail || []) {
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) {
          trainStops.set(stop.name.toLowerCase(), stop)
        }
      }
    }
    for (const route of data.data?.ferry || []) {
      for (const pattern of route.patterns) {
        for (const stop of pattern.stops) {
          ferryStops.set(stop.name.toLowerCase(), stop)
        }
      }
    }

    transitStopsCache = { train: trainStops, ferry: ferryStops, timestamp: now }
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

  // Search ferry stops first (fewer, higher priority)
  for (const [name, stop] of cache.ferry) {
    if (name.includes(q)) {
      results.push({ name: `${stop.name} (Ferry terminal)`, lat: stop.lat, lng: stop.lon })
    }
  }

  // Then train stations
  for (const [name, stop] of cache.train) {
    if (name.includes(q) && !cache.ferry.has(name)) {
      results.push({ name: `${stop.name} (Train station)`, lat: stop.lat, lng: stop.lon })
    }
  }

  return results.slice(0, 5)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] })
  }

  try {
    // Search both OTP stops and Nominatim in parallel
    const nominatimParams = new URLSearchParams({
      q: query,
      format: 'json',
      addressdetails: '1',
      limit: '5',
      countrycodes: 'ee',
      viewbox: '21.5,59.9,28.2,57.5',
      bounded: '1',
    })

    const [stopsResults, nominatimResponse] = await Promise.all([
      searchTransitStops(query),
      fetch(`${NOMINATIM_URL}/search?${nominatimParams}`, {
        headers: { 'User-Agent': 'TallinnTransit/1.0' },
      }),
    ])

    let nominatimResults: GeoResult[] = []
    if (nominatimResponse.ok) {
      interface NominatimResult {
        display_name: string
        lat: string
        lon: string
      }
      const data = await nominatimResponse.json()
      nominatimResults = data.map((item: NominatimResult) => ({
        name: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
      }))
    }

    // Transit stops first, then Nominatim results, limit total to 8
    const results = [...stopsResults, ...nominatimResults].slice(0, 8)

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Geocoding failed:', error)
    return NextResponse.json({ results: [] })
  }
}
