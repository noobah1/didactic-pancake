import { NextResponse } from 'next/server'
import { OTP_BASE_URL } from '@/lib/constants'
import { TransportMode, RouteResult, RouteLeg, LegPlace } from '@/lib/types'

const MODE_TO_OTP: Record<TransportMode, string> = {
  bus: 'BUS',
  tram: 'TRAM',
  train: 'RAIL',
  ferry: 'FERRY',
}

const PLAN_QUERY = `
query Plan($from: InputCoordinates!, $to: InputCoordinates!, $modes: [TransportMode!], $numItineraries: Int!, $date: String, $time: String) {
  plan(
    from: $from,
    to: $to,
    transportModes: $modes,
    numItineraries: $numItineraries,
    date: $date,
    time: $time
  ) {
    itineraries {
      duration
      startTime
      endTime
      walkDistance
      legs {
        mode
        start { scheduledTime estimated { time delay } }
        end { scheduledTime estimated { time delay } }
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
        realTime
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
  estimated?: { time: string; delay?: number } | null
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
  realTime?: boolean
  intermediatePlaces?: GqlPlace[] | null
}

interface GqlItinerary {
  duration: number
  startTime: number
  endTime: number
  walkDistance: number
  legs: GqlLeg[]
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fromPlace = searchParams.get('fromPlace')
  const toPlace = searchParams.get('toPlace')
  const modesParam = searchParams.get('modes')
  const dateTime = searchParams.get('dateTime')

  if (!fromPlace || !toPlace) {
    return NextResponse.json({ error: 'fromPlace and toPlace are required' }, { status: 400 })
  }

  const [fromLat, fromLng] = fromPlace.split(',').map(Number)
  const [toLat, toLng] = toPlace.split(',').map(Number)

  const transportModes: { mode: string }[] = [{ mode: 'WALK' }]
  if (modesParam) {
    modesParam.split(',').forEach((m) => {
      const otpMode = MODE_TO_OTP[m as TransportMode]
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

  if (dateTime) {
    // dateTime comes as "2026-02-27T09:30" from the datetime-local input
    const [date, time] = dateTime.split('T')
    if (date) variables.date = date
    if (time) variables.time = time
  }

  try {
    const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: PLAN_QUERY, variables }),
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`OTP returned ${response.status}`)
    }

    const data = await response.json()

    if (data.errors?.length) {
      console.error('OTP GraphQL errors:', data.errors)
      return NextResponse.json({ error: data.errors[0].message || 'Route planning failed' }, { status: 502 })
    }

    const itineraries: GqlItinerary[] = data.data?.plan?.itineraries || []

    if (itineraries.length === 0) {
      return NextResponse.json({ error: 'No routes found' }, { status: 404 })
    }

    const routes: RouteResult[] = itineraries.map((it, index) => ({
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
          realtime: leg.realTime || false,
          delay: leg.start.estimated?.delay || 0,
        }),
      ),
    }))

    return NextResponse.json({ routes })
  } catch (error) {
    console.error('Failed to fetch route plan:', error)
    return NextResponse.json({ error: 'Route planning service unavailable' }, { status: 502 })
  }
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
