import { NextResponse } from 'next/server'
import { GPS_FEED_URL, OTP_BASE_URL } from '@/lib/constants'
import { parseGpsFeed } from '@/lib/parse-gps'
import { VehiclePosition, TransportMode } from '@/lib/types'

let gpsCache: { data: VehiclePosition[]; timestamp: number } | null = null
let scheduledCache: { data: VehiclePosition[]; timestamp: number } | null = null
const GPS_CACHE_TTL = 5_000 // 5 seconds
const SCHEDULED_CACHE_TTL = 30_000 // 30 seconds

const SCHEDULED_QUERY = `
query ActiveTrips($date: String!) {
  rail: routes(transportModes: [RAIL]) {
    shortName
    mode
    patterns {
      directionId
      tripsForDate(serviceDate: $date) {
        gtfsId
        stoptimes {
          scheduledDeparture
          scheduledArrival
          stop { name lat lon }
        }
      }
    }
  }
  ferry: routes(transportModes: [FERRY]) {
    shortName
    mode
    patterns {
      directionId
      tripsForDate(serviceDate: $date) {
        gtfsId
        stoptimes {
          scheduledDeparture
          scheduledArrival
          stop { name lat lon }
        }
      }
    }
  }
}
`

interface GqlStoptime {
  scheduledDeparture: number
  scheduledArrival: number
  stop: { name: string; lat: number; lon: number }
}

interface GqlTrip {
  gtfsId: string
  stoptimes: GqlStoptime[]
}

interface GqlPattern {
  directionId: number
  tripsForDate: GqlTrip[]
}

interface GqlRoute {
  shortName: string
  mode: string
  patterns: GqlPattern[]
}

function getSecondsSinceMidnight(): number {
  const now = new Date()
  const parts = now.toLocaleTimeString('en-GB', { timeZone: 'Europe/Tallinn', hour12: false }).split(':')
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
}

function getTodayDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Tallinn' })
}

function interpolatePosition(
  stoptimes: GqlStoptime[],
  nowSec: number,
): { lat: number; lng: number; heading: number; destination: string } | null {
  if (stoptimes.length < 2) return null

  const firstDep = stoptimes[0].scheduledDeparture
  const lastArr = stoptimes[stoptimes.length - 1].scheduledArrival || stoptimes[stoptimes.length - 1].scheduledDeparture

  if (nowSec < firstDep || nowSec > lastArr) return null

  const destination = stoptimes[stoptimes.length - 1].stop.name

  for (let i = 0; i < stoptimes.length - 1; i++) {
    const dep = stoptimes[i].scheduledDeparture
    const nextArr = stoptimes[i + 1].scheduledArrival || stoptimes[i + 1].scheduledDeparture

    if (nowSec >= dep && nowSec <= nextArr) {
      const fraction = nextArr === dep ? 0 : (nowSec - dep) / (nextArr - dep)
      const fromStop = stoptimes[i].stop
      const toStop = stoptimes[i + 1].stop

      const lat = fromStop.lat + (toStop.lat - fromStop.lat) * fraction
      const lng = fromStop.lon + (toStop.lon - fromStop.lon) * fraction

      const dLng = ((toStop.lon - fromStop.lon) * Math.PI) / 180
      const lat1 = (fromStop.lat * Math.PI) / 180
      const lat2 = (toStop.lat * Math.PI) / 180
      const y = Math.sin(dLng) * Math.cos(lat2)
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
      const heading = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360

      return { lat, lng, heading: Math.round(heading), destination }
    }
  }

  return null
}

async function fetchScheduledVehicles(): Promise<VehiclePosition[]> {
  const now = Date.now()
  if (scheduledCache && now - scheduledCache.timestamp < SCHEDULED_CACHE_TTL) {
    return scheduledCache.data
  }

  const date = getTodayDate()
  const nowSec = getSecondsSinceMidnight()

  const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SCHEDULED_QUERY, variables: { date } }),
    cache: 'no-store',
  })

  if (!response.ok) return scheduledCache?.data || []

  const data = await response.json()
  if (data.errors?.length) return scheduledCache?.data || []

  const allRoutes: GqlRoute[] = [...(data.data?.rail || []), ...(data.data?.ferry || [])]
  const vehicles: VehiclePosition[] = []
  const seenTrips = new Set<string>()

  for (const route of allRoutes) {
    for (const pattern of route.patterns) {
      for (const trip of pattern.tripsForDate) {
        if (seenTrips.has(trip.gtfsId)) continue
        seenTrips.add(trip.gtfsId)

        const pos = interpolatePosition(trip.stoptimes, nowSec)
        if (!pos) continue

        vehicles.push({
          id: trip.gtfsId,
          mode: route.mode === 'FERRY' ? 'ferry' : 'train',
          line: route.shortName,
          lat: pos.lat,
          lng: pos.lng,
          heading: pos.heading,
          destination: pos.destination,
        })
      }
    }
  }

  scheduledCache = { data: vehicles, timestamp: now }
  return vehicles
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const modesParam = searchParams.get('modes')
  const modes = modesParam ? (modesParam.split(',') as TransportMode[]) : null

  try {
    const now = Date.now()

    // Fetch GPS vehicles (buses/trams)
    if (!gpsCache || now - gpsCache.timestamp > GPS_CACHE_TTL) {
      const response = await fetch(GPS_FEED_URL, { cache: 'no-store' })
      if (!response.ok) throw new Error(`GPS feed returned ${response.status}`)
      const text = await response.text()
      gpsCache = { data: parseGpsFeed(text), timestamp: now }
    }

    // Fetch scheduled vehicles (trains/ferries)
    let scheduled: VehiclePosition[] = []
    try {
      scheduled = await fetchScheduledVehicles()
    } catch {
      // Non-critical: continue with GPS-only vehicles
    }

    let vehicles = [...gpsCache.data, ...scheduled]
    if (modes) {
      vehicles = vehicles.filter((v) => modes.includes(v.mode))
    }

    return NextResponse.json({ vehicles, timestamp: now })
  } catch (error) {
    console.error('Failed to fetch vehicle positions:', error)
    if (gpsCache) {
      return NextResponse.json({
        vehicles: gpsCache.data,
        timestamp: gpsCache.timestamp,
        stale: true,
      })
    }
    return NextResponse.json({ error: 'Failed to fetch vehicle positions' }, { status: 502 })
  }
}
