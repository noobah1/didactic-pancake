import { NextResponse } from 'next/server'
import { OTP_BASE_URL, OTP_FETCH_TIMEOUT_MS, NEARBY_DEFAULT_RADIUS_M, NEARBY_WIDE_RADIUS_M, NEARBY_MAX_STOPS, NEARBY_MAX_PER_NAME } from '@/lib/constants'
import { NearbyStopsData } from '@/lib/types'
import { buildNearbyStops, shouldWiden, GqlNearbyEdge } from '@/lib/nearby-stops'

const NEARBY_STOPS_QUERY = `
query NearbyStops($lat: Float!, $lon: Float!, $radius: Int!, $first: Int!, $numberOfDepartures: Int!) {
  stopsByRadius(lat: $lat, lon: $lon, radius: $radius, first: $first) {
    edges {
      node {
        distance
        stop {
          gtfsId
          name
          lat
          lon
          stoptimesWithoutPatterns(numberOfDepartures: $numberOfDepartures, omitCanceled: true) {
            scheduledDeparture
            realtimeDeparture
            realtime
            serviceDay
            headsign
            trip {
              gtfsId
              route { shortName mode }
            }
          }
        }
      }
    }
  }
}
`

// Fetched per stop, ahead of the ~8 displayed in NearbyPanel — verified live,
// exactly half of stopsByRadius's edges are the feed-2 phantom duplicates (see
// buildNearbyStops), so this needs to be several times NEARBY_MAX_STOPS to
// reliably leave enough real, departure-bearing stops after filtering.
// Also shared by the NEARBY_WIDE_RADIUS_M retry — OTP doesn't return edges
// sorted by distance, so a wider radius with the same `first` risks the
// truncation missing genuinely nearby stops. Verified live at 8km radius in
// real countryside: 40 already finds the same nearest stop 60 does, so this
// stays generous rather than exact.
const STOPS_FETCHED = 60
const DEPARTURES_PER_STOP = 3

// 4dp ~= 11m, same precision/rationale as use-favorites.ts's COORD_PRECISION
// — coarse enough that a GPS fix a few meters off still hits the same cache
// entry, fine enough that it never merges two actually-different locations.
const COORD_PRECISION = 4
function roundCoord(n: number): number {
  return Math.round(n * 10 ** COORD_PRECISION) / 10 ** COORD_PRECISION
}

function cacheKey(lat: number, lon: number, radius: number): string {
  return `${lat},${lon},${radius}`
}

const CACHE_TTL = 20_000
const cache = new Map<string, { data: NearbyStopsData; timestamp: number }>()
// Unlike /api/stop-board (keyed on a bounded set of real stopIds), this cache
// is keyed on rounded coordinates, which are effectively unbounded over a
// long-running server. Sweep expired entries before every insert once the
// map gets large enough for that to matter, rather than adding a timer.
const CACHE_SWEEP_THRESHOLD = 500

function sweepExpiredCache() {
  if (cache.size < CACHE_SWEEP_THRESHOLD) return
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.timestamp >= CACHE_TTL) cache.delete(key)
  }
}

async function queryStopsByRadius(lat: number, lon: number, radius: number, signal: AbortSignal): Promise<GqlNearbyEdge[]> {
  const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: NEARBY_STOPS_QUERY,
      variables: { lat, lon, radius, first: STOPS_FETCHED, numberOfDepartures: DEPARTURES_PER_STOP },
    }),
    cache: 'no-store',
    signal,
  })

  if (!response.ok) throw new Error(`OTP returned ${response.status}`)

  const data = await response.json()
  if (data.errors?.length) throw new Error(data.errors[0].message)

  return data.data?.stopsByRadius?.edges || []
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const latParam = searchParams.get('lat')
  const lngParam = searchParams.get('lng')
  const lat = latParam ? Number(latParam) : NaN
  const lng = lngParam ? Number(lngParam) : NaN
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
  }

  const roundedLat = roundCoord(lat)
  const roundedLng = roundCoord(lng)
  const key = cacheKey(roundedLat, roundedLng, NEARBY_DEFAULT_RADIUS_M)

  const cached = cache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.data)
  }

  // One shared deadline for both the default-radius attempt and the optional
  // widened retry — without this a worst case of two independent 8s timeouts
  // stacks to 16s, which is worse than not attempting the fallback at all.
  const deadline = Date.now() + OTP_FETCH_TIMEOUT_MS

  try {
    const firstEdges = await queryStopsByRadius(
      roundedLat, roundedLng, NEARBY_DEFAULT_RADIUS_M,
      AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
    )
    let stops = buildNearbyStops(firstEdges, NEARBY_MAX_STOPS, NEARBY_MAX_PER_NAME)
    let radiusMeters = NEARBY_DEFAULT_RADIUS_M
    let widened = false

    if (shouldWiden(stops) && deadline - Date.now() > 1_000) {
      const wideEdges = await queryStopsByRadius(
        roundedLat, roundedLng, NEARBY_WIDE_RADIUS_M,
        AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
      )
      const wideStops = buildNearbyStops(wideEdges, NEARBY_MAX_STOPS, NEARBY_MAX_PER_NAME)
      if (wideStops.length > stops.length) {
        stops = wideStops
        radiusMeters = NEARBY_WIDE_RADIUS_M
        widened = true
      }
    }

    const result: NearbyStopsData = { stops, radiusMeters, widened }
    sweepExpiredCache()
    cache.set(key, { data: result, timestamp: Date.now() })
    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to fetch nearby stops:', error)
    if (cached) return NextResponse.json({ ...cached.data, stale: true })
    return NextResponse.json({ error: 'Failed to fetch nearby stops' }, { status: 502 })
  }
}
