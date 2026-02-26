import { NextResponse } from 'next/server'
import { OTP_BASE_URL } from '@/lib/constants'

const ROUTE_SHAPE_QUERY = `
query RouteShape($name: String!, $modes: [Mode!]) {
  routes(name: $name, transportModes: $modes) {
    shortName
    mode
    patterns {
      directionId
      patternGeometry { points }
      stops { name lat lon }
    }
  }
}
`

interface GqlStop {
  name: string
  lat: number
  lon: number
}

interface GqlPattern {
  directionId: number
  patternGeometry?: { points: string } | null
  stops: GqlStop[]
}

interface GqlRoute {
  shortName: string
  mode: string
  patterns: GqlPattern[]
}

const MODE_MAP: Record<string, string> = {
  bus: 'BUS',
  tram: 'TRAM',
  train: 'RAIL',
  ferry: 'FERRY',
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const line = searchParams.get('line')
  const mode = searchParams.get('mode')

  if (!line || !mode) {
    return NextResponse.json({ error: 'line and mode are required' }, { status: 400 })
  }

  const otpMode = MODE_MAP[mode]
  if (!otpMode) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
  }

  try {
    const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: ROUTE_SHAPE_QUERY,
        variables: { name: line, modes: [otpMode] },
      }),
    })

    if (!response.ok) {
      throw new Error(`OTP returned ${response.status}`)
    }

    const data = await response.json()

    if (data.errors?.length) {
      return NextResponse.json({ error: data.errors[0].message }, { status: 502 })
    }

    const routes: GqlRoute[] = data.data?.routes || []
    if (routes.length === 0) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 })
    }

    // Return all patterns for the matching route
    const route = routes[0]
    const patterns = route.patterns
      .filter((p) => p.patternGeometry?.points)
      .map((p) => ({
        directionId: p.directionId,
        geometry: p.patternGeometry!.points,
        stops: p.stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lon })),
      }))

    return NextResponse.json({ line: route.shortName, mode: route.mode, patterns })
  } catch (error) {
    console.error('Failed to fetch route shape:', error)
    return NextResponse.json({ error: 'Failed to fetch route shape' }, { status: 502 })
  }
}
