import { NextResponse } from 'next/server'
import {
  GPS_FEED_URL,
  OTP_BASE_URL,
  OTP_FETCH_TIMEOUT_MS,
  GPS_FEED_TIMEOUT_MS,
  ELRON_AGENCY_GTFS_ID,
} from '@/lib/constants'
import { parseGpsFeed } from '@/lib/parse-gps'
import { fetchElronVehicles } from '@/lib/elron'
import { decodePolyline } from '@/lib/decode-polyline'
import { getServiceDate, getServiceSeconds } from '@/lib/service-date'
import { VehiclePosition, TransportMode } from '@/lib/types'

let gpsCache: { data: VehiclePosition[]; timestamp: number } | null = null
let scheduledCache: { data: ScheduledResult; timestamp: number } | null = null
const GPS_CACHE_TTL = 5_000 // 5 seconds
const SCHEDULED_CACHE_TTL = 30_000 // 30 seconds

const SCHEDULED_QUERY = `
query ActiveTrips($date: String!) {
  rail: routes(transportModes: [RAIL]) {
    shortName
    mode
    agency { gtfsId }
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
  agency?: { gtfsId: string } | null
  patterns: GqlPattern[]
}

// Everything needed to turn one of Elron's bare live positions (see
// src/lib/elron.ts — a trip id and a coordinate, nothing else) into a full
// vehicle: which line it is, where it's headed, and geometry to read a
// heading off.
interface RailTripInfo {
  line: string
  destination: string
  shapeCoords: [number, number][] | null
}

interface ScheduledResult {
  vehicles: VehiclePosition[]
  // Every Elron trip running today, not just the ones currently mid-journey —
  // a badly delayed train is outside its own scheduled window, which is
  // exactly when its live position matters most.
  railTrips: Map<string, RailTripInfo>
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
    case 'TROLLEYBUS': return 'trolleybus'
    default: return 'bus'
  }
}

async function fetchTallinnGpsVehicles(): Promise<VehiclePosition[]> {
  const now = Date.now()
  if (gpsCache && now - gpsCache.timestamp < GPS_CACHE_TTL) {
    return gpsCache.data
  }
  const response = await fetch(GPS_FEED_URL, {
    cache: 'no-store',
    signal: AbortSignal.timeout(GPS_FEED_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`GPS feed returned ${response.status}`)
  const text = await response.text()
  gpsCache = { data: parseGpsFeed(text), timestamp: now }
  return gpsCache.data
}

const EMPTY_SCHEDULED: ScheduledResult = { vehicles: [], railTrips: new Map() }

async function fetchScheduledVehicles(): Promise<ScheduledResult> {
  const now = Date.now()
  if (scheduledCache && now - scheduledCache.timestamp < SCHEDULED_CACHE_TTL) {
    return scheduledCache.data
  }

  const date = getServiceDate()
  const nowSec = getServiceSeconds()

  const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SCHEDULED_QUERY, variables: { date } }),
    cache: 'no-store',
    signal: AbortSignal.timeout(OTP_FETCH_TIMEOUT_MS),
  })

  if (!response.ok) return scheduledCache?.data || EMPTY_SCHEDULED

  const data = await response.json()
  if (data.errors?.length) return scheduledCache?.data || EMPTY_SCHEDULED

  // Elron's schedule sits in the graph twice, under two feeds (see
  // ELRON_AGENCY_GTFS_ID) — without scoping to one, every train is drawn
  // twice, two markers stacked on the same coordinate. Fall back to the
  // unfiltered list if that agency id ever stops matching (e.g. a future
  // graph rebuild renumbers it) rather than silently showing no trains.
  const railRoutes: GqlRoute[] = data.data?.rail || []
  const elronRoutes = railRoutes.filter((r) => r.agency?.gtfsId === ELRON_AGENCY_GTFS_ID)
  const scopedRail = elronRoutes.length > 0 ? elronRoutes : railRoutes

  const allRoutes: GqlRoute[] = [
    ...scopedRail,
    ...(data.data?.ferry || []),
    ...(data.data?.bus || []),
    ...(data.data?.tram || []),
  ]
  const vehicles: VehiclePosition[] = []
  const railTrips = new Map<string, RailTripInfo>()
  const seenTrips = new Set<string>()

  for (const route of allRoutes) {
    for (const pattern of route.patterns) {
      const shapeCoords = pattern.patternGeometry?.points
        ? decodePolyline(pattern.patternGeometry.points)
        : null

      const mode = mapOtpMode(route.mode)

      for (const trip of pattern.tripsForDate) {
        if (seenTrips.has(trip.gtfsId)) continue
        seenTrips.add(trip.gtfsId)

        // Indexed before the in-motion check below, so a train running well
        // outside its scheduled window still resolves to a line/destination
        // when its live position comes in.
        if (mode === 'train' && trip.stoptimes.length > 0) {
          railTrips.set(trip.gtfsId, {
            line: route.shortName,
            destination: trip.stoptimes[trip.stoptimes.length - 1].stop.name,
            shapeCoords,
          })
        }

        const pos = interpolatePosition(trip.stoptimes, nowSec, shapeCoords)
        if (!pos) continue

        vehicles.push({
          id: trip.gtfsId,
          mode,
          line: route.shortName,
          lat: pos.lat,
          lng: pos.lng,
          heading: pos.heading,
          destination: pos.destination,
          estimated: true,
        })
      }
    }
  }

  const result: ScheduledResult = { vehicles, railTrips }
  scheduledCache = { data: result, timestamp: now }
  return result
}

// Elron's feed carries no bearing (confirmed absent on every entity), so read
// the direction of travel off the trip's own shape instead: the pattern
// geometry runs in the direction the train travels, so the tangent at the
// point nearest the train is its heading. Better than deriving one from
// successive polls — correct on the very first sighting, and unbothered by a
// train sitting still at a platform.
function headingFromShape(shapeCoords: [number, number][], lat: number, lng: number): number {
  const lats = shapeCoords.map((c) => c[1])
  const lons = shapeCoords.map((c) => c[0])
  const idx = findNearestPointIndex(lats, lons, lat, lng)
  const from = idx < lats.length - 1 ? idx : Math.max(0, idx - 1)
  const to = Math.min(from + 1, lats.length - 1)
  if (from === to) return 0
  return calcHeading(lats[from], lons[from], lats[to], lons[to])
}

// Elron's real-time trip ids join exactly onto OTP's own (see toOtpTripId), so
// unlike Tallinn's feed — whose vehicles carry only a line number and have to
// be scored against every candidate trip by position and heading — a train's
// trip is known outright, with no matching and no chance of a wrong guess.
function buildLiveTrains(
  elron: { tripId: string; lat: number; lng: number }[],
  railTrips: Map<string, RailTripInfo>,
): VehiclePosition[] {
  const trains: VehiclePosition[] = []
  for (const v of elron) {
    const info = railTrips.get(v.tripId)
    // A trip the graph doesn't know about (feed drift, or a train running a
    // trip from a service date the graph hasn't got) can't be labelled with a
    // line or destination — showing it as an unnamed dot is worse than
    // leaving the scheduled estimate in place.
    if (!info) continue
    trains.push({
      id: v.tripId,
      mode: 'train',
      line: info.line,
      lat: v.lat,
      lng: v.lng,
      heading: info.shapeCoords && info.shapeCoords.length > 1
        ? headingFromShape(info.shapeCoords, v.lat, v.lng)
        : 0,
      destination: info.destination,
    })
  }
  return trains
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

    // Tallinn's live GPS feed, Elron's live train feed, and the nationwide
    // OTP schedule query are all independent of each other — fetching them one
    // after another stacked every timeout (up to 5s + 5s + 8s = 18s worst
    // case) into a single request.
    const [gpsVehicles, elron, scheduled] = await Promise.all([
      includesTallinn ? fetchTallinnGpsVehicles() : Promise.resolve<VehiclePosition[]>([]),
      // Non-critical, and an unofficial third-party mirror at that: trains
      // fall back to their scheduled estimate if it fails.
      fetchElronVehicles().catch(() => []),
      // Non-critical: continue with GPS-only vehicles if this fails.
      fetchScheduledVehicles().catch(() => EMPTY_SCHEDULED),
    ])

    const liveTrains = buildLiveTrains(elron, scheduled.railTrips)
    // A train with a live position must not also appear as its own
    // schedule-interpolated ghost — same trip, same id, two markers, one of
    // them wrong. The live one wins; the estimate only covers trains the feed
    // isn't currently reporting.
    const liveTrainTripIds = new Set(liveTrains.map((t) => t.id))

    // Merge: use live GPS for Tallinn bus/tram and Elron trains, scheduled for
    // everything else. Only exclude scheduled bus/tram that overlap with
    // Tallinn's live GPS area.
    let vehicles: VehiclePosition[]
    if (includesTallinn) {
      const isTallinnArea = (v: VehiclePosition) =>
        Math.abs(v.lat - 59.437) < CITY_RADIUS_DEG && Math.abs(v.lng - 24.754) < CITY_RADIUS_DEG
      const scheduledFiltered = scheduled.vehicles.filter(
        (v) =>
          !liveTrainTripIds.has(v.id) &&
          (!isTallinnArea(v) || v.mode === 'train' || v.mode === 'ferry'),
      )
      vehicles = [...gpsVehicles, ...liveTrains, ...scheduledFiltered]
    } else {
      vehicles = [
        ...liveTrains,
        ...scheduled.vehicles.filter((v) => !liveTrainTripIds.has(v.id)),
      ]
    }

    // Filter by city locations (trains/ferries bypass — they're intercity)
    if (cityCoords.length > 0) {
      const intercity = vehicles.filter((v) => v.mode === 'train' || v.mode === 'ferry')
      const local = vehicles.filter((v) => v.mode !== 'train' && v.mode !== 'ferry')
      vehicles = [...filterByCities(local, cityCoords), ...intercity]
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
