import { NextResponse } from 'next/server'
import { OTP_BASE_URL } from '@/lib/constants'
import { mapDeparture, mapWheelchairBoarding, GqlStoptime } from '@/lib/stop-departures'
import { StopDeparture, StopInfo } from '@/lib/types'

const DEPARTURES_QUERY = `
query StopDepartures($id: String!, $n: Int!) {
  stop(id: $id) {
    gtfsId
    name
    lat
    lon
    wheelchairBoarding
    stoptimesWithoutPatterns(numberOfDepartures: $n, omitNonPickups: true) {
      serviceDay
      scheduledDeparture
      realtimeDeparture
      realtime
      headsign
      trip {
        gtfsId
        route { shortName mode }
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
  wheelchairBoarding?: string | null
  stoptimesWithoutPatterns?: GqlStoptime[] | null
}

interface DeparturesPayload {
  stop: StopInfo
  departures: StopDeparture[]
  timestamp: number
}

const cache = new Map<string, { data: DeparturesPayload; timestamp: number }>()
const CACHE_TTL = 20_000

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const stopId = searchParams.get('stopId')
  const n = Math.min(parseInt(searchParams.get('n') || '12', 10) || 12, 30)
  if (!stopId) {
    return NextResponse.json({ error: 'stopId is required' }, { status: 400 })
  }

  const cacheKey = `${stopId}:${n}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.timestamp < CACHE_TTL) {
    return NextResponse.json(hit.data)
  }

  try {
    const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: DEPARTURES_QUERY, variables: { id: stopId, n } }),
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`OTP returned ${response.status}`)

    const json = await response.json()
    const stop: GqlStop | null = json.data?.stop
    if (!stop) return NextResponse.json({ error: 'Stop not found' }, { status: 404 })

    const payload: DeparturesPayload = {
      stop: {
        stopId: stop.gtfsId,
        name: stop.name,
        lat: stop.lat,
        lng: stop.lon,
        wheelchairBoarding: mapWheelchairBoarding(stop.wheelchairBoarding),
      },
      departures: (stop.stoptimesWithoutPatterns || [])
        .map(mapDeparture)
        .filter((d): d is StopDeparture => d !== null)
        .sort((a, b) => a.departure - b.departure),
      timestamp: Date.now(),
    }

    cache.set(cacheKey, { data: payload, timestamp: Date.now() })
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Failed to fetch stop departures:', error)
    if (hit) return NextResponse.json({ ...hit.data, stale: true })
    return NextResponse.json({ error: 'Departures unavailable' }, { status: 502 })
  }
}
