import { NextResponse } from 'next/server'
import { OTP_BASE_URL } from '@/lib/constants'
import { otpModeToLocal } from '@/lib/otp'
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

interface GqlStoptime {
  serviceDay: number
  scheduledDeparture: number
  realtimeDeparture: number
  realtime: boolean
  headsign?: string | null
  trip?: {
    gtfsId: string
    route?: { shortName?: string | null; mode?: string | null } | null
  } | null
}

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

function mapDeparture(st: GqlStoptime): StopDeparture | null {
  if (!st.trip) return null
  // serviceDay is epoch seconds at the *service day's* midnight; scheduledDeparture/
  // realtimeDeparture are seconds-since-that-midnight offsets (>= 86400 past midnight).
  // The absolute time is always serviceDay + offset — never treat the offset alone as a clock.
  const departure = (st.serviceDay + (st.realtime ? st.realtimeDeparture : st.scheduledDeparture)) * 1000
  const delaySeconds = st.realtime ? st.realtimeDeparture - st.scheduledDeparture : 0

  return {
    tripId: st.trip.gtfsId,
    line: st.trip.route?.shortName || '',
    mode: otpModeToLocal(st.trip.route?.mode || ''),
    headsign: st.headsign || '',
    departure,
    scheduledDeparture: (st.serviceDay + st.scheduledDeparture) * 1000,
    realtime: st.realtime,
    delaySeconds,
  }
}

function mapWheelchairBoarding(v?: string | null): StopInfo['wheelchairBoarding'] {
  if (v === 'POSSIBLE' || v === 'NOT_POSSIBLE') return v
  return 'NO_INFORMATION'
}

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
