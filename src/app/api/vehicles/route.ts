import { NextResponse } from 'next/server'
import { GPS_FEED_URL, OTP_BASE_URL } from '@/lib/constants'
import { parseGpsFeed } from '@/lib/parse-gps'
import { decodePolyline } from '@/lib/decode-polyline'
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
      patternGeometry { points }
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
      patternGeometry { points }
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
  bus: routes(transportModes: [BUS]) {
    shortName
    mode
    patterns {
      directionId
      patternGeometry { points }
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
  tram: routes(transportModes: [TRAM]) {
    shortName
    mode
    patterns {
      directionId
      patternGeometry { points }
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
  patternGeometry?: { points: string } | null
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

function distSq(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dlat = lat2 - lat1
  const dlon = lon2 - lon1
  return dlat * dlat + dlon * dlon
}

function findNearestPointIndex(
  shapeLats: number[],
  shapeLons: number[],
  lat: number,
  lon: number,
  searchStart = 0,
): number {
  let bestIdx = searchStart
  let bestDist = Infinity
  for (let i = searchStart; i < shapeLats.length; i++) {
    const d = distSq(shapeLats[i], shapeLons[i], lat, lon)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return bestIdx
}

function calcHeading(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLng = ((lon2 - lon1) * Math.PI) / 180
  const rLat1 = (lat1 * Math.PI) / 180
  const rLat2 = (lat2 * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(rLat2)
  const x = Math.cos(rLat1) * Math.sin(rLat2) - Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLng)
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360)
}

function interpolateAlongShape(
  shapeLats: number[],
  shapeLons: number[],
  fromIdx: number,
  toIdx: number,
  fraction: number,
): { lat: number; lng: number; heading: number } {
  if (fromIdx === toIdx) {
    return { lat: shapeLats[fromIdx], lng: shapeLons[fromIdx], heading: 0 }
  }

  const start = Math.min(fromIdx, toIdx)
  const end = Math.max(fromIdx, toIdx)
  const forward = fromIdx <= toIdx

  // Calculate cumulative distances along the shape segment
  const distances = [0]
  for (let i = start + 1; i <= end; i++) {
    const dlat = shapeLats[i] - shapeLats[i - 1]
    const dlon = shapeLons[i] - shapeLons[i - 1]
    distances.push(distances[distances.length - 1] + Math.sqrt(dlat * dlat + dlon * dlon))
  }
  const totalDist = distances[distances.length - 1]
  if (totalDist === 0) {
    return { lat: shapeLats[start], lng: shapeLons[start], heading: 0 }
  }

  const adjustedFraction = forward ? fraction : 1 - fraction
  const targetDist = adjustedFraction * totalDist

  for (let i = 0; i < distances.length - 1; i++) {
    if (targetDist >= distances[i] && targetDist <= distances[i + 1]) {
      const segFrac =
        distances[i + 1] === distances[i]
          ? 0
          : (targetDist - distances[i]) / (distances[i + 1] - distances[i])
      const si = start + i
      const lat = shapeLats[si] + (shapeLats[si + 1] - shapeLats[si]) * segFrac
      const lng = shapeLons[si] + (shapeLons[si + 1] - shapeLons[si]) * segFrac
      const heading = calcHeading(shapeLats[si], shapeLons[si], shapeLats[si + 1], shapeLons[si + 1])
      return { lat, lng, heading }
    }
  }

  // Fallback: last point
  return {
    lat: shapeLats[end],
    lng: shapeLons[end],
    heading: 0,
  }
}

function interpolatePosition(
  stoptimes: GqlStoptime[],
  nowSec: number,
  shapeCoords?: [number, number][] | null,
): { lat: number; lng: number; heading: number; destination: string } | null {
  if (stoptimes.length < 2) return null

  const firstDep = stoptimes[0].scheduledDeparture
  const lastArr =
    stoptimes[stoptimes.length - 1].scheduledArrival || stoptimes[stoptimes.length - 1].scheduledDeparture

  if (nowSec < firstDep || nowSec > lastArr) return null

  const destination = stoptimes[stoptimes.length - 1].stop.name

  // Pre-compute shape arrays and stop indices if shape is available
  let shapeLats: number[] | null = null
  let shapeLons: number[] | null = null
  let stopShapeIndices: number[] | null = null
  if (shapeCoords && shapeCoords.length > 1) {
    shapeLats = shapeCoords.map((c) => c[1])
    shapeLons = shapeCoords.map((c) => c[0])
    // Map each stop to its nearest point on the shape, searching forward
    stopShapeIndices = []
    let searchFrom = 0
    for (const st of stoptimes) {
      const idx = findNearestPointIndex(shapeLats, shapeLons, st.stop.lat, st.stop.lon, searchFrom)
      stopShapeIndices.push(idx)
      searchFrom = idx
    }
  }

  for (let i = 0; i < stoptimes.length - 1; i++) {
    const arr = stoptimes[i].scheduledArrival || stoptimes[i].scheduledDeparture
    const dep = stoptimes[i].scheduledDeparture
    const nextArr = stoptimes[i + 1].scheduledArrival || stoptimes[i + 1].scheduledDeparture

    // Train is dwelling at stop i (between arrival and departure)
    if (i > 0 && nowSec >= arr && nowSec < dep) {
      const stop = stoptimes[i].stop
      const heading =
        i < stoptimes.length - 1
          ? calcHeading(stop.lat, stop.lon, stoptimes[i + 1].stop.lat, stoptimes[i + 1].stop.lon)
          : 0
      return { lat: stop.lat, lng: stop.lon, heading, destination }
    }

    // Train is between stop i and stop i+1
    if (nowSec >= dep && nowSec <= nextArr) {
      const fraction = nextArr === dep ? 0 : (nowSec - dep) / (nextArr - dep)
      const fromStop = stoptimes[i].stop
      const toStop = stoptimes[i + 1].stop

      // Use shape geometry if available
      if (shapeLats && shapeLons && stopShapeIndices) {
        const result = interpolateAlongShape(
          shapeLats,
          shapeLons,
          stopShapeIndices[i],
          stopShapeIndices[i + 1],
          fraction,
        )
        return { ...result, destination }
      }

      // Fallback: straight-line interpolation
      const lat = fromStop.lat + (toStop.lat - fromStop.lat) * fraction
      const lng = fromStop.lon + (toStop.lon - fromStop.lon) * fraction
      const heading = calcHeading(fromStop.lat, fromStop.lon, toStop.lat, toStop.lon)
      return { lat, lng, heading, destination }
    }
  }

  return null
}

function mapOtpMode(mode: string): TransportMode {
  switch (mode) {
    case 'RAIL': return 'train'
    case 'FERRY': return 'ferry'
    case 'TRAM': return 'tram'
    default: return 'bus'
  }
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

  const allRoutes: GqlRoute[] = [
    ...(data.data?.rail || []),
    ...(data.data?.ferry || []),
    ...(data.data?.bus || []),
    ...(data.data?.tram || []),
  ]
  const vehicles: VehiclePosition[] = []
  const seenTrips = new Set<string>()

  for (const route of allRoutes) {
    for (const pattern of route.patterns) {
      const shapeCoords = pattern.patternGeometry?.points
        ? decodePolyline(pattern.patternGeometry.points)
        : null

      for (const trip of pattern.tripsForDate) {
        if (seenTrips.has(trip.gtfsId)) continue
        seenTrips.add(trip.gtfsId)

        const pos = interpolatePosition(trip.stoptimes, nowSec, shapeCoords)
        if (!pos) continue

        vehicles.push({
          id: trip.gtfsId,
          mode: mapOtpMode(route.mode),
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

// ~30km radius for city filtering (in degrees, rough approximation)
const CITY_RADIUS_DEG = 0.3

function filterByCities(vehicles: VehiclePosition[], cityCoords: { lat: number; lng: number }[]): VehiclePosition[] {
  return vehicles.filter((v) =>
    cityCoords.some((city) => {
      const dlat = Math.abs(v.lat - city.lat)
      const dlng = Math.abs(v.lng - city.lng)
      return dlat < CITY_RADIUS_DEG && dlng < CITY_RADIUS_DEG
    }),
  )
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const modesParam = searchParams.get('modes')
  const modes = modesParam ? (modesParam.split(',') as TransportMode[]) : null

  // Parse cities param: "lat,lng;lat,lng;..."
  const citiesParam = searchParams.get('cities')
  const cityCoords: { lat: number; lng: number }[] = citiesParam
    ? citiesParam.split(';').map((pair) => {
        const [lat, lng] = pair.split(',').map(Number)
        return { lat, lng }
      }).filter((c) => !isNaN(c.lat) && !isNaN(c.lng))
    : []

  const includesTallinn = cityCoords.length === 0 || cityCoords.some(
    (c) => Math.abs(c.lat - 59.437) < 0.1 && Math.abs(c.lng - 24.754) < 0.1,
  )

  try {
    const now = Date.now()
    let gpsVehicles: VehiclePosition[] = []

    // Fetch Tallinn live GPS vehicles (only when Tallinn is selected)
    if (includesTallinn) {
      if (!gpsCache || now - gpsCache.timestamp > GPS_CACHE_TTL) {
        const response = await fetch(GPS_FEED_URL, { cache: 'no-store' })
        if (!response.ok) throw new Error(`GPS feed returned ${response.status}`)
        const text = await response.text()
        gpsCache = { data: parseGpsFeed(text), timestamp: now }
      }
      gpsVehicles = gpsCache.data
    }

    // Fetch scheduled vehicles (all modes, nationwide)
    let scheduled: VehiclePosition[] = []
    try {
      scheduled = await fetchScheduledVehicles()
    } catch {
      // Non-critical: continue with GPS-only vehicles
    }

    // Merge: use live GPS for Tallinn bus/tram, scheduled for everything else
    // Only exclude scheduled bus/tram that overlap with Tallinn's live GPS area
    let vehicles: VehiclePosition[]
    if (includesTallinn) {
      const isTallinnArea = (v: VehiclePosition) =>
        Math.abs(v.lat - 59.437) < CITY_RADIUS_DEG && Math.abs(v.lng - 24.754) < CITY_RADIUS_DEG
      const scheduledFiltered = scheduled.filter(
        (v) => !isTallinnArea(v) || v.mode === 'train' || v.mode === 'ferry',
      )
      vehicles = [...gpsVehicles, ...scheduledFiltered]
    } else {
      vehicles = scheduled
    }

    // Filter by city locations
    if (cityCoords.length > 0) {
      vehicles = filterByCities(vehicles, cityCoords)
    }

    if (modes) {
      vehicles = vehicles.filter((v) => modes.includes(v.mode))
    }

    return NextResponse.json({ vehicles, timestamp: now })
  } catch (error) {
    console.error('Failed to fetch vehicle positions:', error)
    if (gpsCache && includesTallinn) {
      return NextResponse.json({
        vehicles: gpsCache.data,
        timestamp: gpsCache.timestamp,
        stale: true,
      })
    }
    return NextResponse.json({ error: 'Failed to fetch vehicle positions' }, { status: 502 })
  }
}
