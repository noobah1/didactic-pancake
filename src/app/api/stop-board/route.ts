import { NextResponse } from 'next/server'
import { OTP_BASE_URL, OTP_FETCH_TIMEOUT_MS } from '@/lib/constants'
import { StopBoardData, StopDeparture, TransportMode } from '@/lib/types'

const STOP_FIELDS = `
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
`

// /api/geocode merges every physical stop sharing a name (separate bus bays,
// a tram platform across the road, etc.) into one search result carrying all
// their stopIds — this builds one query aliasing stop0, stop1, ... so a
// multi-platform board still costs a single OTP round trip.
function buildStopBoardQuery(count: number): string {
  const vars = Array.from({ length: count }, (_, i) => `$stopId${i}: String!`).join(', ')
  const fields = Array.from({ length: count }, (_, i) => `stop${i}: stop(id: $stopId${i}) {${STOP_FIELDS}}`).join('\n')
  return `query StopBoard($numberOfDepartures: Int!, ${vars}) {\n${fields}\n}`
}

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
  const stopIdParam = searchParams.get('stopId')
  if (!stopIdParam) {
    return NextResponse.json({ error: 'stopId is required' }, { status: 400 })
  }
  // Comma-separated when /api/geocode merged several physical stops under
  // one name (see buildStopBoardQuery above) — otherwise just the one id.
  const stopIds = stopIdParam.split(',').map((id) => id.trim()).filter(Boolean)
  if (stopIds.length === 0) {
    return NextResponse.json({ error: 'stopId is required' }, { status: 400 })
  }

  const cached = cache.get(stopIdParam)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.data)
  }

  try {
    const variables: Record<string, string | number> = { numberOfDepartures: 12 }
    stopIds.forEach((id, i) => { variables[`stopId${i}`] = id })

    const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: buildStopBoardQuery(stopIds.length),
        variables,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(OTP_FETCH_TIMEOUT_MS),
    })

    if (!response.ok) throw new Error(`OTP returned ${response.status}`)

    const data = await response.json()
    if (data.errors?.length) {
      return NextResponse.json({ error: data.errors[0].message }, { status: 502 })
    }

    const stops: GqlStop[] = stopIds
      .map((_, i) => data.data?.[`stop${i}`] as GqlStop | null)
      .filter((s): s is GqlStop => s != null)
    if (stops.length === 0) {
      return NextResponse.json({ error: 'Stop not found' }, { status: 404 })
    }

    // A trip could in principle call at more than one of the merged
    // platforms (a loop route) — key on trip+departure time so it only
    // shows once.
    const seen = new Set<string>()
    const departures: StopDeparture[] = stops
      .flatMap((stop) => stop.stoptimesWithoutPatterns)
      .map((st): StopDeparture => ({
        tripId: st.trip.gtfsId,
        line: st.trip.route.shortName,
        mode: otpModeToLocal(st.trip.route.mode),
        headsign: st.headsign || '',
        departureEpochSec: st.serviceDay + (st.realtime ? st.realtimeDeparture : st.scheduledDeparture),
        realtime: st.realtime,
        delaySeconds: st.realtime ? st.realtimeDeparture - st.scheduledDeparture : undefined,
      }))
      .filter((dep) => {
        const key = `${dep.tripId}-${dep.departureEpochSec}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => a.departureEpochSec - b.departureEpochSec)
      .slice(0, 12)

    const board: StopBoardData = { stopName: stops[0].name, lat: stops[0].lat, lng: stops[0].lon, departures }
    cache.set(stopIdParam, { data: board, timestamp: Date.now() })
    return NextResponse.json(board)
  } catch (error) {
    console.error('Failed to fetch stop board:', error)
    if (cached) return NextResponse.json({ ...cached.data, stale: true })
    return NextResponse.json({ error: 'Failed to fetch stop board' }, { status: 502 })
  }
}
