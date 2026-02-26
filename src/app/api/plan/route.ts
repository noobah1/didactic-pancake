import { NextResponse } from 'next/server'
import { OTP_BASE_URL } from '@/lib/constants'
import { TransportMode, RouteResult, RouteLeg, LegPlace } from '@/lib/types'

const MODE_TO_OTP: Record<TransportMode, string> = {
  bus: 'BUS',
  tram: 'TRAM',
  trolleybus: 'TROLLEYBUS',
  train: 'RAIL',
  ferry: 'FERRY',
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

  const transitModes = modesParam
    ? modesParam
        .split(',')
        .map((m) => MODE_TO_OTP[m as TransportMode])
        .filter(Boolean)
        .join(',')
    : 'BUS,TRAM,TROLLEYBUS,RAIL,FERRY'

  const params = new URLSearchParams({
    fromPlace,
    toPlace,
    mode: `WALK,TRANSIT`,
    transitModes,
    numItineraries: '5',
    ...(dateTime ? { date: dateTime.split('T')[0], time: dateTime.split('T')[1] } : {}),
  })

  try {
    const response = await fetch(`${OTP_BASE_URL}/otp/routers/default/plan?${params}`, {
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`OTP returned ${response.status}`)
    }

    const data = await response.json()

    if (data.error) {
      return NextResponse.json({ error: data.error.message || 'No routes found' }, { status: 404 })
    }

    const routes: RouteResult[] = (data.plan?.itineraries || []).map((it: any, index: number) => ({
      id: `route-${index}`,
      duration: it.duration,
      startTime: new Date(it.startTime).toISOString(),
      endTime: new Date(it.endTime).toISOString(),
      walkDistance: it.walkDistance,
      legs: it.legs.map(
        (leg: any): RouteLeg => ({
          mode: leg.mode === 'WALK' ? 'walk' : otpModeToLocal(leg.mode),
          from: mapPlace(leg.from),
          to: mapPlace(leg.to),
          startTime: new Date(leg.startTime).toISOString(),
          endTime: new Date(leg.endTime).toISOString(),
          duration: leg.duration,
          route: leg.route || undefined,
          tripId: leg.tripId || undefined,
          legGeometry: leg.legGeometry || undefined,
          realtime: leg.realTime || false,
          delay: leg.departureDelay || 0,
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
    TROLLEYBUS: 'trolleybus',
    RAIL: 'train',
    FERRY: 'ferry',
  }
  return map[otpMode] || 'bus'
}

function mapPlace(place: any): LegPlace {
  return {
    name: place.name || '',
    lat: place.lat,
    lng: place.lon,
    stopId: place.stopId || undefined,
    departure: place.departure ? new Date(place.departure).toISOString() : undefined,
    arrival: place.arrival ? new Date(place.arrival).toISOString() : undefined,
  }
}
