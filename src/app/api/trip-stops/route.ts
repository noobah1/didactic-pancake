import { NextResponse } from 'next/server'
import { OTP_BASE_URL } from '@/lib/constants'
import { TripStopInfo } from '@/lib/types'

// Direct lookup by trip ID — includes pattern geometry for route line
const TRIP_STOPS_QUERY = `
query TripStops($tripId: String!) {
  trip(id: $tripId) {
    gtfsId
    route { shortName mode }
    pattern { patternGeometry { points } }
    stoptimes {
      scheduledArrival
      scheduledDeparture
      stop { name lat lon gtfsId }
    }
  }
}
`

// Lookup by route name + mode — includes pattern geometry for route line
const ROUTE_TRIPS_QUERY = `
query RouteTrips($name: String!, $modes: [Mode!], $date: String!) {
  routes(name: $name, transportModes: $modes) {
    shortName
    mode
    patterns {
      patternGeometry { points }
      tripsForDate(serviceDate: $date) {
        gtfsId
        stoptimes {
          scheduledArrival
          scheduledDeparture
          stop { name lat lon gtfsId }
        }
      }
    }
  }
}
`

const MODE_MAP: Record<string, string> = {
  bus: 'BUS',
  tram: 'TRAM',
  train: 'RAIL',
  ferry: 'FERRY',
}

interface GqlStoptime {
  scheduledArrival: number
  scheduledDeparture: number
  stop: { name: string; lat: number; lon: number; gtfsId: string }
}

interface GqlTrip {
  gtfsId: string
  route?: { shortName: string; mode: string }
  pattern?: { patternGeometry?: { points: string } | null } | null
  stoptimes: GqlStoptime[]
  _patternGeometry?: string // attached during route matching
}

function getSecondsSinceMidnight(): number {
  const now = new Date()
  const parts = now
    .toLocaleTimeString('en-GB', { timeZone: 'Europe/Tallinn', hour12: false })
    .split(':')
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
}

function getTodayDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Tallinn' })
}

const BUFFER_SEC = 59 // grace period before marking late/passed

function computeStatus(
  stoptimes: GqlStoptime[],
  nowSec: number,
): TripStopInfo[] {
  return stoptimes.map((st, i) => {
    const arr = st.scheduledArrival
    const dep = st.scheduledDeparture

    let status: 'passed' | 'current' | 'upcoming' = 'upcoming'

    if (nowSec >= dep + BUFFER_SEC) {
      status = 'passed'
    } else if (nowSec >= arr && nowSec < dep + BUFFER_SEC) {
      status = 'current'
    } else if (i > 0) {
      const prevDep = stoptimes[i - 1].scheduledDeparture
      if (nowSec >= prevDep && nowSec < arr) {
        status = 'upcoming'
      }
    }

    return {
      name: st.stop.name,
      lat: st.stop.lat,
      lng: st.stop.lon,
      stopId: st.stop.gtfsId,
      scheduledArrival: arr,
      scheduledDeparture: dep,
      status,
    }
  })
}

// Project point onto line segment, return fraction (0-1) along segment
function projectOntoSegment(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): { fraction: number; dist: number } {
  const dx = bLon - aLon
  const dy = bLat - aLat
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return { fraction: 0, dist: distanceMeters(pLat, pLon, aLat, aLon) }
  let t = ((pLon - aLon) * dx + (pLat - aLat) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const projLat = aLat + t * dy
  const projLon = aLon + t * dx
  return { fraction: t, dist: distanceMeters(pLat, pLon, projLat, projLon) }
}

// Use GPS position + schedule time to determine which stops are passed/current/upcoming
function computeStatusFromGPS(
  stoptimes: GqlStoptime[],
  vLat: number,
  vLng: number,
  nowSec: number,
): { stops: TripStopInfo[]; afterStopIndex: number; fraction: number } {
  // Use time as a hint but search wider — GPS position is the truth
  let timeSegIdx = -1
  for (let i = 0; i < stoptimes.length - 1; i++) {
    const dep = stoptimes[i].scheduledDeparture
    const nextArr = stoptimes[i + 1].scheduledArrival
    if (nowSec >= dep && nowSec <= nextArr) { timeSegIdx = i; break }
    if (nowSec >= stoptimes[i].scheduledArrival && nowSec < dep) { timeSegIdx = Math.max(0, i - 1); break }
  }
  if (timeSegIdx < 0 && stoptimes.length >= 2) {
    const lastDep = stoptimes[stoptimes.length - 1].scheduledDeparture
    if (nowSec >= lastDep) timeSegIdx = stoptimes.length - 2
  }
  const searchFrom = 0
  const searchTo = stoptimes.length - 1
  let bestSegIdx = timeSegIdx >= 0 ? timeSegIdx : 0
  let bestDist = Infinity
  let bestFraction = 0

  for (let i = searchFrom; i < searchTo; i++) {
    const a = stoptimes[i].stop
    const b = stoptimes[i + 1].stop
    const proj = projectOntoSegment(vLat, vLng, a.lat, a.lon, b.lat, b.lon)
    if (proj.dist < bestDist) {
      bestDist = proj.dist
      bestSegIdx = i
      bestFraction = proj.fraction
    }
  }

  // Check if vehicle is very close to a stop (within 150m), also constrained by time window
  let atStopIdx = -1
  for (let i = searchFrom; i <= searchTo; i++) {
    const d = distanceMeters(vLat, vLng, stoptimes[i].stop.lat, stoptimes[i].stop.lon)
    if (d < 150) {
      atStopIdx = i
      break
    }
  }

  if (atStopIdx >= 0 && Math.abs(atStopIdx - bestSegIdx) <= 1) {
    bestSegIdx = Math.max(0, atStopIdx - 1)
    bestFraction = atStopIdx === 0 ? 0 : 1
  }

  const stops: TripStopInfo[] = stoptimes.map((st, i) => {
    let status: 'passed' | 'current' | 'upcoming' = 'upcoming'
    if (i < bestSegIdx || (i === bestSegIdx && bestFraction > 0.9)) {
      status = 'passed'
    } else if (i === bestSegIdx) {
      status = 'passed'
    } else if (atStopIdx >= 0 && i === atStopIdx) {
      status = 'current'
    }
    return {
      name: st.stop.name,
      lat: st.stop.lat,
      lng: st.stop.lon,
      stopId: st.stop.gtfsId,
      scheduledArrival: st.scheduledArrival,
      scheduledDeparture: st.scheduledDeparture,
      status,
    }
  })

  // Calculate actual delay based on GPS position vs schedule
  // Use the next upcoming stop for delay calculation — more accurate
  const nextStopIdx = bestSegIdx + 1
  const refStop = nextStopIdx < stoptimes.length ? stoptimes[nextStopIdx] : stoptimes[bestSegIdx]
  const scheduledTimeSec = refStop.scheduledArrival
  // Only count delay if vehicle hasn't reached the stop yet
  const distToNext = nextStopIdx < stoptimes.length 
    ? distanceMeters(vLat, vLng, stoptimes[nextStopIdx].stop.lat, stoptimes[nextStopIdx].stop.lon)
    : Infinity
  const delaySec = distToNext > 100 ? nowSec - scheduledTimeSec : 0
  const stopsWithDelay: TripStopInfo[] = stops.map((stop, i) => {
    if (stop.status === 'passed') return stop
    return {
      ...stop,
      scheduledArrival: stop.scheduledArrival + delaySec,
      scheduledDeparture: stop.scheduledDeparture + delaySec,
    }
  })

  return { stops: stopsWithDelay, afterStopIndex: bestSegIdx, fraction: bestFraction }
}

function buildResponse(
  trip: GqlTrip,
  nowSec: number,
  line?: string,
  mode?: string,
  vLat?: number | null,
  vLng?: number | null,
) {
  const geometry = trip._patternGeometry || trip.pattern?.patternGeometry?.points || null

  // Use GPS to determine stop status when position is available
  if (vLat != null && vLng != null && trip.stoptimes.length >= 2) {
    const { stops, afterStopIndex, fraction } = computeStatusFromGPS(trip.stoptimes, vLat, vLng, nowSec)
    return {
      tripId: trip.gtfsId,
      line: line || trip.route?.shortName || '',
      mode: mode || trip.route?.mode || '',
      stops,
      currentTimeSeconds: nowSec,
      geometry,
      vehiclePosition: { afterStopIndex, fraction },
    }
  }

  // Time-based for scheduled vehicles (no GPS)
  const stops = computeStatus(trip.stoptimes, nowSec)
  return {
    tripId: trip.gtfsId,
    line: line || trip.route?.shortName || '',
    mode: mode || trip.route?.mode || '',
    stops,
    currentTimeSeconds: nowSec,
    geometry,
    vehiclePosition: null,
  }
}

// Haversine distance in meters between two points
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Score a trip by how close the vehicle's GPS position is to where the trip should be right now
function tripPositionScore(trip: GqlTrip, nowSec: number, vLat: number, vLng: number): number {
  // Find the closest segment on the route to the GPS position
  let bestDist = Infinity
  for (let i = 0; i < trip.stoptimes.length - 1; i++) {
    const a = trip.stoptimes[i].stop
    const b = trip.stoptimes[i + 1].stop
    const proj = projectOntoSegment(vLat, vLng, a.lat, a.lon, b.lat, b.lon)
    if (proj.dist < bestDist) bestDist = proj.dist
  }
  return bestDist
}

// Calculate heading (degrees) from point A to point B
function calcHeading(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLng = ((lon2 - lon1) * Math.PI) / 180
  const rLat1 = (lat1 * Math.PI) / 180
  const rLat2 = (lat2 * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(rLat2)
  const x = Math.cos(rLat1) * Math.sin(rLat2) - Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

// Get the general heading of a trip (first stop to last stop)
function tripHeading(trip: GqlTrip): number {
  const first = trip.stoptimes[0].stop
  const last = trip.stoptimes[trip.stoptimes.length - 1].stop
  return calcHeading(first.lat, first.lon, last.lat, last.lon)
}

// Angular difference between two headings (0-180)
function headingDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

// Find the best matching trip from a route's trips for a GPS vehicle
function findBestTrip(
  trips: GqlTrip[],
  nowSec: number,
  destination?: string | null,
  vehicleLat?: number | null,
  vehicleLng?: number | null,
  vehicleHeading?: number | null,
): GqlTrip | null {
  // Filter to trips currently running (between first departure and last arrival)
  const activeTrips = trips.filter((t) => {
    if (t.stoptimes.length < 2) return false
    const firstDep = t.stoptimes[0].scheduledDeparture
    const lastArr = t.stoptimes[t.stoptimes.length - 1].scheduledArrival
      || t.stoptimes[t.stoptimes.length - 1].scheduledDeparture
    return nowSec >= firstDep && nowSec <= lastArr + BUFFER_SEC
  })

  if (activeTrips.length === 0) return null

  // Step 1: Filter by destination to get the correct direction
  let directionTrips = activeTrips
  if (destination) {
    const destLower = destination.toLowerCase().trim()
    const matched = activeTrips.filter((t) => {
      const lastStop = t.stoptimes[t.stoptimes.length - 1].stop.name.toLowerCase()
      return lastStop === destLower || lastStop.includes(destLower) || destLower.includes(lastStop)
    })
    if (matched.length > 0) directionTrips = matched
  }

  // Step 2: If destination didn't narrow it down, use heading to filter direction
  if (directionTrips.length === activeTrips.length && vehicleHeading != null && activeTrips.length >= 2) {
    const withHeading = activeTrips.filter((t) => headingDiff(vehicleHeading, tripHeading(t)) < 90)
    if (withHeading.length > 0) directionTrips = withHeading
  }

  // Step 3: Among direction-matched trips, use GPS position to pick the best one
  if (vehicleLat != null && vehicleLng != null) {
    let bestTrip = directionTrips[0]
    let bestDist = Infinity
    for (const trip of directionTrips) {
      const dist = tripPositionScore(trip, nowSec, vehicleLat, vehicleLng)
      if (dist < bestDist) {
        bestDist = dist
        bestTrip = trip
      }
    }
    return bestTrip
  }

  // Step 4: No GPS — pick the trip closest to current time
  if (directionTrips.length === 1) return directionTrips[0]

  let bestTrip = directionTrips[0]
  let bestDiff = Infinity
  for (const trip of directionTrips) {
    const diff = Math.abs(nowSec - trip.stoptimes[0].scheduledDeparture)
    if (diff < bestDiff) {
      bestDiff = diff
      bestTrip = trip
    }
  }
  return bestTrip
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tripId = searchParams.get('tripId')
  const line = searchParams.get('line')
  const mode = searchParams.get('mode')
  const destination = searchParams.get('destination')
  const vehicleLat = searchParams.get('lat') ? parseFloat(searchParams.get('lat')!) : null
  const vehicleLng = searchParams.get('lng') ? parseFloat(searchParams.get('lng')!) : null
  const vehicleHeading = searchParams.get('heading') ? parseFloat(searchParams.get('heading')!) : null

  const nowSec = getSecondsSinceMidnight()

  // Method 1: Direct trip ID lookup (scheduled vehicles)
  if (tripId) {
    try {
      const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: TRIP_STOPS_QUERY,
          variables: { tripId },
        }),
      })

      if (!response.ok) throw new Error(`OTP returned ${response.status}`)

      const data = await response.json()
      if (data.errors?.length) {
        return NextResponse.json({ error: data.errors[0].message }, { status: 502 })
      }

      const trip: GqlTrip | null = data.data?.trip
      if (!trip) {
        return NextResponse.json({ error: 'Trip not found' }, { status: 404 })
      }

      return NextResponse.json(buildResponse(trip, nowSec, undefined, undefined, vehicleLat, vehicleLng))
    } catch (error) {
      console.error('Failed to fetch trip stops:', error)
      return NextResponse.json({ error: 'Failed to fetch trip stops' }, { status: 502 })
    }
  }

  // Method 2: Match by line + mode (GPS vehicles)
  if (line && mode) {
    const otpMode = MODE_MAP[mode]
    if (!otpMode) {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
    }

    try {
      const date = getTodayDate()
      const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: ROUTE_TRIPS_QUERY,
          variables: { name: line, modes: [otpMode], date },
        }),
      })

      if (!response.ok) throw new Error(`OTP returned ${response.status}`)

      const data = await response.json()
      if (data.errors?.length) {
        return NextResponse.json({ error: data.errors[0].message }, { status: 502 })
      }

      const routes = data.data?.routes || []
      if (routes.length === 0) {
        return NextResponse.json({ error: 'Route not found' }, { status: 404 })
      }

      // Collect all trips from all patterns, attaching pattern geometry to each trip
      const allTrips: GqlTrip[] = []
      for (const route of routes) {
        for (const pattern of route.patterns) {
          const geo = pattern.patternGeometry?.points || undefined
          for (const trip of pattern.tripsForDate) {
            if (geo) trip._patternGeometry = geo
            allTrips.push(trip)
          }
        }
      }

      const bestTrip = findBestTrip(allTrips, nowSec, destination, vehicleLat, vehicleLng, vehicleHeading)
      if (!bestTrip) {
        return NextResponse.json({ error: 'No active trip found for this route' }, { status: 404 })
      }

      return NextResponse.json(buildResponse(bestTrip, nowSec, line, otpMode, vehicleLat, vehicleLng))
    } catch (error) {
      console.error('Failed to match trip:', error)
      return NextResponse.json({ error: 'Failed to match trip' }, { status: 502 })
    }
  }

  return NextResponse.json({ error: 'Provide tripId or line+mode' }, { status: 400 })
}
