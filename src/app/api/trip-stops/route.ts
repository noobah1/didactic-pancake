import { NextResponse } from 'next/server'
import { OTP_BASE_URL, TALLINN_TRANSPORT_AGENCY_GTFS_ID } from '@/lib/constants'
import { TripStopInfo } from '@/lib/types'
import { LATE_BUFFER_SEC, computeStatusFromGPS, findBestTrip } from '@/lib/delay'
import { getServiceDate, getServiceSeconds } from '@/lib/service-date'

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
    agency { gtfsId }
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

// Tallinn's unified GTFS feed tags trolleybus routes with GTFS mode BUS (no
// TROLLEYBUS route_type in the data) — so trolleybus route/trip lookups query
// OTP as BUS. GPS-position scoring in findBestTrip() still picks the correct
// trip among same-numbered routes elsewhere in the country.
const MODE_MAP: Record<string, string> = {
  bus: 'BUS',
  tram: 'TRAM',
  train: 'RAIL',
  ferry: 'FERRY',
  trolleybus: 'BUS',
  nightbus: 'BUS',
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

function computeStatus(
  stoptimes: GqlStoptime[],
  nowSec: number,
): TripStopInfo[] {
  return stoptimes.map((st, i) => {
    const arr = st.scheduledArrival
    const dep = st.scheduledDeparture

    let status: 'passed' | 'current' | 'upcoming' = 'upcoming'

    if (nowSec >= dep + LATE_BUFFER_SEC) {
      status = 'passed'
    } else if (nowSec >= arr && nowSec < dep + LATE_BUFFER_SEC) {
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

function buildResponse(
  trip: GqlTrip,
  nowSec: number,
  line?: string,
  mode?: string,
  vLat?: number | null,
  vLng?: number | null,
  hasRealGps?: boolean,
) {
  const geometry = trip._patternGeometry || trip.pattern?.patternGeometry?.points || null

  // Use GPS to determine stop status only when the position is real live GPS
  // (never for interpolated/scheduled positions — those would report a false
  // "confirmed on time" delaySeconds of 0 instead of no live evidence at all).
  if (hasRealGps && vLat != null && vLng != null && trip.stoptimes.length >= 2) {
    const { stops, afterStopIndex, fraction, delaySeconds } = computeStatusFromGPS(trip.stoptimes, vLat, vLng, nowSec)
    return {
      tripId: trip.gtfsId,
      line: line || trip.route?.shortName || '',
      mode: mode || trip.route?.mode || '',
      stops,
      currentTimeSeconds: nowSec,
      geometry,
      vehiclePosition: { afterStopIndex, fraction },
      delaySeconds,
    }
  }

  // Time-based for scheduled vehicles (no real GPS)
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tripId = searchParams.get('tripId')
  const line = searchParams.get('line')
  const mode = searchParams.get('mode')
  const destination = searchParams.get('destination')
  const vehicleLat = searchParams.get('lat') ? parseFloat(searchParams.get('lat')!) : null
  const vehicleLng = searchParams.get('lng') ? parseFloat(searchParams.get('lng')!) : null
  const vehicleHeading = searchParams.get('heading') ? parseFloat(searchParams.get('heading')!) : null

  const nowSec = getServiceSeconds()

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

      // Method 1 positions are interpolated/scheduled, never real GPS —
      // never claim a confirmed delay for them.
      return NextResponse.json(buildResponse(trip, nowSec, undefined, undefined, vehicleLat, vehicleLng, false))
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

   // Tram route shortNames carry a T-prefix (e.g. "T2") since the GTFS rebuild
    const routeName = mode === 'tram' && !/^T/i.test(line) ? `T${line}` : line

    try {
      const date = getServiceDate()
      const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: ROUTE_TRIPS_QUERY,
          variables: { name: routeName, modes: [otpMode], date },
        }),
      })

      if (!response.ok) throw new Error(`OTP returned ${response.status}`)

      const data = await response.json()
      if (data.errors?.length) {
        return NextResponse.json({ error: data.errors[0].message }, { status: 502 })
      }

      const substringMatches: { shortName: string; mode: string; agency?: { gtfsId: string } | null; patterns: { patternGeometry?: { points: string } | null; tripsForDate: GqlTrip[] }[] }[] =
        data.data?.routes || []
      if (substringMatches.length === 0) {
        return NextResponse.json({ error: 'Route not found' }, { status: 404 })
      }

      // OTP's routes(name:) is a substring match, not exact — querying "2"
      // also returns "20".."28" (anything whose shortName contains "2").
      // Narrow to an exact (case-insensitive) shortName match first — the
      // wide substring set is only a fallback for the rare shortName that
      // doesn't compare equal cleanly (e.g. trailing whitespace in the feed).
      const exactMatches = substringMatches.filter((r) => r.shortName.toLowerCase() === routeName.toLowerCase())
      const allRoutes = exactMatches.length > 0 ? exactMatches : substringMatches

      // Method 2 only ever matches a live Tallinn GPS vehicle (bus, tram,
      // trolleybus, nightbus — nothing else has live GPS) — scope candidates
      // to Tallinn's own operator so a same-numbered route from an unrelated
      // town never wins the GPS-position match (see
      // TALLINN_TRANSPORT_AGENCY_GTFS_ID). Fall back to the unfiltered list
      // if the agency id ever stops matching anything.
      const tallinnRoutes = allRoutes.filter((r) => r.agency?.gtfsId === TALLINN_TRANSPORT_AGENCY_GTFS_ID)
      const routes = tallinnRoutes.length > 0 ? tallinnRoutes : allRoutes

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

      // Method 2 vehicles are matched from real live GPS positions.
      return NextResponse.json(buildResponse(bestTrip, nowSec, line, otpMode, vehicleLat, vehicleLng, true))
    } catch (error) {
      console.error('Failed to match trip:', error)
      return NextResponse.json({ error: 'Failed to match trip' }, { status: 502 })
    }
  }

  return NextResponse.json({ error: 'Provide tripId or line+mode' }, { status: 400 })
}
