import { OTP_BASE_URL, OTP_FETCH_TIMEOUT_MS } from '@/lib/constants'
import { TransportMode, RouteResult, RouteLeg, LegPlace } from '@/lib/types'

// Tallinn's unified GTFS feed tags trolleybus routes with GTFS mode BUS (no
// TROLLEYBUS route_type in the data), so trip planning requests BUS for it too.
const MODE_TO_OTP: Record<TransportMode, string> = {
  bus: 'BUS',
  tram: 'TRAM',
  train: 'RAIL',
  ferry: 'FERRY',
  trolleybus: 'BUS',
  nightbus: 'BUS',
}

const PLAN_QUERY = `
query Plan($from: InputCoordinates!, $to: InputCoordinates!, $modes: [TransportMode!], $numItineraries: Int!, $date: String, $time: String, $arriveBy: Boolean, $banned: InputBanned) {
  plan(
    from: $from,
    to: $to,
    transportModes: $modes,
    numItineraries: $numItineraries,
    date: $date,
    time: $time,
    arriveBy: $arriveBy,
    banned: $banned
  ) {
    itineraries {
      duration
      startTime
      endTime
      walkDistance
      legs {
        mode
        start { scheduledTime estimated { time } }
        end { scheduledTime estimated { time } }
        from {
          name
          lat
          lon
          stop { gtfsId }
          departure { scheduledTime estimated { time } }
        }
        to {
          name
          lat
          lon
          stop { gtfsId }
          arrival { scheduledTime estimated { time } }
        }
        duration
        route { shortName }
        trip { gtfsId }
        legGeometry { points }
        intermediatePlaces {
          name
          lat
          lon
          stop { gtfsId }
          departure { scheduledTime estimated { time } }
          arrival { scheduledTime estimated { time } }
        }
      }
    }
  }
}
`

interface GqlTime {
  scheduledTime: string
  estimated?: { time: string } | null
}

interface GqlPlace {
  name?: string
  lat: number
  lon: number
  stop?: { gtfsId: string } | null
  departure?: GqlTime | null
  arrival?: GqlTime | null
}

interface GqlLeg {
  mode: string
  start: GqlTime
  end: GqlTime
  from: GqlPlace
  to: GqlPlace
  duration: number
  route?: { shortName: string } | null
  trip?: { gtfsId: string } | null
  legGeometry?: { points: string } | null
  intermediatePlaces?: GqlPlace[] | null
}

interface GqlItinerary {
  duration: number
  startTime: number
  endTime: number
  walkDistance: number
  legs: GqlLeg[]
}

export interface PlanOptions {
  modes?: TransportMode[]
  dateTime?: string
  arriveBy?: boolean
  bannedTrips?: string
}

export interface PlanResult {
  routes?: RouteResult[]
  notice?: string
  error?: string
  status?: number
}

// Shared by /api/plan (rider-facing search) and the push-notification
// checker (src/lib/push-checker.ts, re-planning each favorite in the
// background) — extracted so the OTP query/mapping logic exists in exactly
// one place rather than being duplicated between an HTTP route and a
// server-internal caller.
export async function planTrip(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  options: PlanOptions = {},
): Promise<PlanResult> {
  const transportModes: { mode: string }[] = [{ mode: 'WALK' }]
  if (options.modes?.length) {
    options.modes.forEach((m) => {
      const otpMode = MODE_TO_OTP[m]
      if (otpMode) transportModes.push({ mode: otpMode })
    })
  } else {
    transportModes.push({ mode: 'BUS' }, { mode: 'TRAM' }, { mode: 'RAIL' }, { mode: 'FERRY' })
  }

  const variables: Record<string, unknown> = {
    from: { lat: fromLat, lon: fromLng },
    to: { lat: toLat, lon: toLng },
    modes: transportModes,
    numItineraries: 5,
  }

  if (options.dateTime) {
    // dateTime comes as "2026-02-27T09:30" from the datetime-local input
    const [date, time] = options.dateTime.split('T')
    if (date) variables.date = date
    if (time) variables.time = time
  }

  if (options.arriveBy) {
    variables.arriveBy = true
  }

  // "Get alternatives" on a delay warning bans the specific trip(s) running
  // late instead of just re-issuing the identical query, which would almost
  // always come back with the exact same top itinerary.
  if (options.bannedTrips) {
    variables.banned = { trips: options.bannedTrips }
  }

  try {
    const primary = await fetchItineraries(variables)

    if (primary.hardError) {
      return { error: primary.hardError, status: 502 }
    }

    if (primary.itineraries.length > 0) {
      return { routes: mapItineraries(primary.itineraries) }
    }

    // No itinerary at all — before giving up, check whether a plain walk is
    // even possible. A rural stop can genuinely have just one bus a day
    // (confirmed live: a real address matched to a stop with buses at
    // 09:20/13:18/15:25 and nothing else, so a request at 21:00 correctly
    // finds nothing to ride) — "No routes found" alone reads as broken
    // rather than "already gone for today," and leaves the rider with
    // nothing actionable. Falling back to a walking itinerary at least
    // answers "can I still get there," with a notice explaining why transit
    // didn't turn up anything.
    const walkOnly = await fetchItineraries({ ...variables, modes: [{ mode: 'WALK' }], numItineraries: 1 })
    if (walkOnly.itineraries.length > 0) {
      return {
        routes: mapItineraries(walkOnly.itineraries),
        notice: 'No transit found for this time — showing a walking route instead.',
      }
    }

    return { error: 'No routes found', status: 404 }
  } catch (error) {
    console.error('Failed to fetch route plan:', error)
    return { error: 'Route planning service unavailable', status: 502 }
  }
}

async function fetchItineraries(
  variables: Record<string, unknown>,
): Promise<{ itineraries: GqlItinerary[]; hardError?: string }> {
  const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: PLAN_QUERY, variables }),
    cache: 'no-store',
    signal: AbortSignal.timeout(OTP_FETCH_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`OTP returned ${response.status}`)
  }

  const data = await response.json()
  const itineraries: GqlItinerary[] = data.data?.plan?.itineraries || []

  if (data.errors?.length) {
    const nonFareErrors = data.errors.filter((e: { message?: string }) => !e.message?.includes('currency'))
    if (nonFareErrors.length > 0 && itineraries.length === 0) {
      console.error('OTP GraphQL errors:', data.errors)
      return { itineraries: [], hardError: nonFareErrors[0].message || 'Route planning failed' }
    }
  }

  return { itineraries }
}

function mapItineraries(itineraries: GqlItinerary[]): RouteResult[] {
  return itineraries.map((it, index) => ({
    id: `route-${index}`,
    duration: it.duration,
    startTime: new Date(it.startTime).toISOString(),
    endTime: new Date(it.endTime).toISOString(),
    walkDistance: it.walkDistance,
    legs: it.legs.map(
      (leg): RouteLeg => ({
        mode: leg.mode === 'WALK' ? 'walk' : otpModeToLocal(leg.mode),
        from: mapPlace(leg.from),
        to: mapPlace(leg.to),
        startTime: resolveTime(leg.start),
        endTime: resolveTime(leg.end),
        duration: leg.duration,
        route: leg.route?.shortName || undefined,
        tripId: leg.trip?.gtfsId || undefined,
        intermediateStops: leg.intermediatePlaces?.map(mapPlace) || undefined,
        legGeometry: leg.legGeometry || undefined,
      }),
    ),
  }))
}

function otpModeToLocal(otpMode: string): TransportMode {
  const map: Record<string, TransportMode> = {
    BUS: 'bus',
    TRAM: 'tram',
    RAIL: 'train',
    FERRY: 'ferry',
  }
  return map[otpMode] || 'bus'
}

function resolveTime(t: GqlTime): string {
  return t.estimated?.time || t.scheduledTime
}

function mapPlace(place: GqlPlace): LegPlace {
  return {
    name: place.name || '',
    lat: place.lat,
    lng: place.lon,
    stopId: place.stop?.gtfsId || undefined,
    departure: place.departure
      ? (place.departure.estimated?.time || place.departure.scheduledTime)
      : undefined,
    arrival: place.arrival
      ? (place.arrival.estimated?.time || place.arrival.scheduledTime)
      : undefined,
  }
}
