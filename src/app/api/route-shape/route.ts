import { NextResponse } from 'next/server'
import { OTP_BASE_URL, TALLINN_TRANSPORT_AGENCY_GTFS_ID } from '@/lib/constants'

const ROUTE_SHAPE_QUERY = `
query RouteShape($name: String!, $modes: [Mode!]) {
  routes(name: $name, transportModes: $modes) {
    shortName
    mode
    agency { gtfsId }
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
  agency?: { gtfsId: string } | null
  patterns: GqlPattern[]
}

// Tallinn's unified GTFS feed tags trolleybus routes with GTFS mode BUS (no
// TROLLEYBUS route_type in the data) — so trolleybus shape lookups query OTP as BUS.
const MODE_MAP: Record<string, string> = {
  bus: 'BUS',
  tram: 'TRAM',
  train: 'RAIL',
  ferry: 'FERRY',
  trolleybus: 'BUS',
  nightbus: 'BUS',
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

  // Tram route shortNames carry a T-prefix (e.g. "T2") since the GTFS rebuild
  const routeName = mode === 'tram' && !/^T/i.test(line) ? `T${line}` : line

  try {
    const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: ROUTE_SHAPE_QUERY,
        variables: { name: routeName, modes: [otpMode] },
      }),
    })

    if (!response.ok) {
      throw new Error(`OTP returned ${response.status}`)
    }

    const data = await response.json()

    if (data.errors?.length) {
      return NextResponse.json({ error: data.errors[0].message }, { status: 502 })
    }

    const substringMatches: GqlRoute[] = data.data?.routes || []
    if (substringMatches.length === 0) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 })
    }

    // OTP's routes(name:) is a substring match, not exact — querying "2"
    // also returns "20".."28" (anything whose shortName contains "2"), and
    // this endpoint picks routes[0] with zero further disambiguation. Narrow
    // to an exact (case-insensitive) shortName match first.
    const exactMatches = substringMatches.filter((r) => r.shortName.toLowerCase() === routeName.toLowerCase())
    const allRoutes = exactMatches.length > 0 ? exactMatches : substringMatches

    // bus/tram/trolleybus/nightbus route numbers are NOT unique nationwide —
    // dozens of unrelated regional operators reuse the same low numbers, so
    // picking routes[0] unfiltered can silently draw a completely different
    // town's route. Rail/ferry stay nationwide unfiltered since they're
    // genuinely intercity and aren't part of this collision. Fall back to
    // the unfiltered list if the agency filter ever matches nothing.
    let routes = allRoutes
    if (otpMode === 'BUS' || otpMode === 'TRAM') {
      const tallinnRoutes = allRoutes.filter((r) => r.agency?.gtfsId === TALLINN_TRANSPORT_AGENCY_GTFS_ID)
      if (tallinnRoutes.length > 0) routes = tallinnRoutes
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
