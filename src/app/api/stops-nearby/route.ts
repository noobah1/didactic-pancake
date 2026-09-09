import { NextResponse } from 'next/server'
import { OTP_BASE_URL } from '@/lib/constants'
import { otpModeToLocalOrUndefined } from '@/lib/otp'
import { dedupeCoincidentStops } from '@/lib/stops'
import { StopInfo } from '@/lib/types'

const STOPS_RADIUS_QUERY = `
query StopsNearby($lat: Float!, $lon: Float!, $radius: Int!, $first: Int!) {
  stopsByRadius(lat: $lat, lon: $lon, radius: $radius, first: $first) {
    edges {
      node {
        distance
        stop { gtfsId name lat lon vehicleMode wheelchairBoarding }
      }
    }
  }
}
`

interface GqlStop {
  gtfsId: string
  name: string
  lat: number
  lon: number
  vehicleMode?: string | null
  wheelchairBoarding?: string | null
}

interface GqlEdge {
  node: { distance: number; stop: GqlStop }
}

const MAX_RADIUS = 2000
const MAX_FIRST = 30

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = parseFloat(searchParams.get('lat') || '')
  const lng = parseFloat(searchParams.get('lng') || '')
  const radius = Math.min(parseInt(searchParams.get('radius') || '500', 10) || 500, MAX_RADIUS)
  const first = Math.min(parseInt(searchParams.get('first') || '12', 10) || 12, MAX_FIRST)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
  }

  try {
    const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: STOPS_RADIUS_QUERY,
        variables: { lat, lon: lng, radius, first },
      }),
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`OTP returned ${response.status}`)

    const json = await response.json()
    const edges: GqlEdge[] = json.data?.stopsByRadius?.edges || []

    const mapped: StopInfo[] = edges.map((e) => ({
      stopId: e.node.stop.gtfsId,
      name: e.node.stop.name,
      lat: e.node.stop.lat,
      lng: e.node.stop.lon,
      mode: otpModeToLocalOrUndefined(e.node.stop.vehicleMode),
      distance: e.node.distance,
    }))

    // Same coincident-stop duplication as /api/stops — dedupe, then sort by
    // distance since dedupeCoincidentStops doesn't guarantee input order.
    const deduped = dedupeCoincidentStops(mapped)
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))

    return NextResponse.json({ stops: deduped })
  } catch (error) {
    console.error('Failed to fetch nearby stops:', error)
    return NextResponse.json({ stops: [] })
  }
}
