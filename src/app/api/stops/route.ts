import { NextResponse } from 'next/server'
import { OTP_BASE_URL } from '@/lib/constants'
import { otpModeToLocalOrUndefined } from '@/lib/otp'
import { dedupeCoincidentStops } from '@/lib/stops'
import { StopInfo } from '@/lib/types'

const STOPS_BBOX_QUERY = `
query StopsInBbox($minLat: Float!, $minLon: Float!, $maxLat: Float!, $maxLon: Float!) {
  stopsByBbox(minLat: $minLat, minLon: $minLon, maxLat: $maxLat, maxLon: $maxLon) {
    gtfsId
    name
    lat
    lon
    vehicleMode
  }
}
`

interface GqlStop {
  gtfsId: string
  name: string
  lat: number
  lon: number
  vehicleMode?: string | null
}

// Bounding boxes larger than this would return every stop in Estonia and
// stall OTP — the client only calls this at zoom >= 15, where a real
// viewport is always much smaller than this.
const MAX_BBOX_DEGREES = 0.5

const cache = new Map<string, { data: { stops: StopInfo[] }; timestamp: number }>()
const CACHE_TTL = 300_000 // 5 min — stop locations are static data

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const bbox = searchParams.get('bbox')
  if (!bbox) {
    return NextResponse.json({ error: 'bbox is required' }, { status: 400 })
  }

  const parts = bbox.split(',').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: 'bbox must be minLng,minLat,maxLng,maxLat' }, { status: 400 })
  }
  const [minLng, minLat, maxLng, maxLat] = parts

  if (maxLng - minLng > MAX_BBOX_DEGREES || maxLat - minLat > MAX_BBOX_DEGREES) {
    return NextResponse.json({ error: 'bbox too large' }, { status: 400 })
  }

  const cacheKey = `${minLng.toFixed(2)},${minLat.toFixed(2)},${maxLng.toFixed(2)},${maxLat.toFixed(2)}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.timestamp < CACHE_TTL) {
    return NextResponse.json(hit.data)
  }

  try {
    const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: STOPS_BBOX_QUERY,
        variables: { minLat, minLon: minLng, maxLat, maxLon: maxLng },
      }),
    })
    if (!response.ok) throw new Error(`OTP returned ${response.status}`)

    const json = await response.json()
    const gqlStops: GqlStop[] = json.data?.stopsByBbox || []

    const mapped: StopInfo[] = gqlStops.map((s) => ({
      stopId: s.gtfsId,
      name: s.name,
      lat: s.lat,
      lng: s.lon,
      mode: otpModeToLocalOrUndefined(s.vehicleMode),
    }))

    const stops = dedupeCoincidentStops(mapped)
    const data = { stops }
    cache.set(cacheKey, { data, timestamp: Date.now() })
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch stops:', error)
    if (hit) return NextResponse.json({ ...hit.data, stale: true })
    return NextResponse.json({ stops: [] })
  }
}
