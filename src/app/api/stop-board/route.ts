import { NextResponse } from 'next/server'
import { OTP_BASE_URL, OTP_FETCH_TIMEOUT_MS } from '@/lib/constants'
import { StopBoardData, StopDeparture, TransportMode } from '@/lib/types'

const STOP_BOARD_QUERY = `
query StopBoard($stopId: String!, $numberOfDepartures: Int!) {
  stop(id: $stopId) {
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
`

interface GqlStoptime {
  scheduledDeparture: number
  realtimeDeparture: number
  realtime: boolean
  serviceDay: number
  headsign?: string | null
  trip: {
    gtfsId: string
    route: { shortName: string; mode: string }
  }
}

interface GqlStop {
  name: string
  lat: number
  lon: number
  stoptimesWithoutPatterns: GqlStoptime[]
}

// Tallinn's unified GTFS feed tags trolleybus routes with GTFS mode BUS (no
// TROLLEYBUS route_type in the data — same limitation noted in trip-stops
// and route-shape) — a scheduled trolleybus departure shows here as "bus",
// since nothing in a schedule-only query can tell the two apart.
function otpModeToLocal(mode: string): TransportMode {
  const map: Record<string, TransportMode> = {
    BUS: 'bus',
    TRAM: 'tram',
    RAIL: 'train',
    FERRY: 'ferry',
  }
  return map[mode] || 'bus'
}

const CACHE_TTL = 20_000
const cache = new Map<string, { data: StopBoardData; timestamp: number }>()

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const stopId = searchParams.get('stopId')
  if (!stopId) {
    return NextResponse.json({ error: 'stopId is required' }, { status: 400 })
  }

  const cached = cache.get(stopId)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.data)
  }

  try {
    const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: STOP_BOARD_QUERY,
        variables: { stopId, numberOfDepartures: 12 },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(OTP_FETCH_TIMEOUT_MS),
    })

    if (!response.ok) throw new Error(`OTP returned ${response.status}`)

    const data = await response.json()
    if (data.errors?.length) {
      return NextResponse.json({ error: data.errors[0].message }, { status: 502 })
    }

    const stop: GqlStop | null = data.data?.stop
    if (!stop) {
      return NextResponse.json({ error: 'Stop not found' }, { status: 404 })
    }

    const departures: StopDeparture[] = stop.stoptimesWithoutPatterns
      .map((st): StopDeparture => ({
        tripId: st.trip.gtfsId,
        line: st.trip.route.shortName,
        mode: otpModeToLocal(st.trip.route.mode),
        headsign: st.headsign || '',
        departureEpochSec: st.serviceDay + (st.realtime ? st.realtimeDeparture : st.scheduledDeparture),
        realtime: st.realtime,
        delaySeconds: st.realtime ? st.realtimeDeparture - st.scheduledDeparture : undefined,
      }))
      .sort((a, b) => a.departureEpochSec - b.departureEpochSec)

    const board: StopBoardData = { stopName: stop.name, lat: stop.lat, lng: stop.lon, departures }
    cache.set(stopId, { data: board, timestamp: Date.now() })
    return NextResponse.json(board)
  } catch (error) {
    console.error('Failed to fetch stop board:', error)
    if (cached) return NextResponse.json({ ...cached.data, stale: true })
    return NextResponse.json({ error: 'Failed to fetch stop board' }, { status: 502 })
  }
}
