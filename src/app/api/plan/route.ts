import { NextResponse } from 'next/server'
import { TransportMode } from '@/lib/types'
import { planTrip } from '@/lib/plan-query'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fromPlace = searchParams.get('fromPlace')
  const toPlace = searchParams.get('toPlace')
  const modesParam = searchParams.get('modes')
  const dateTime = searchParams.get('dateTime')
  const arriveBy = searchParams.get('arriveBy') === 'true'
  const bannedTrips = searchParams.get('bannedTrips')

  if (!fromPlace || !toPlace) {
    return NextResponse.json({ error: 'fromPlace and toPlace are required' }, { status: 400 })
  }

  const [fromLat, fromLng] = fromPlace.split(',').map(Number)
  const [toLat, toLng] = toPlace.split(',').map(Number)

  const result = await planTrip(fromLat, fromLng, toLat, toLng, {
    modes: modesParam ? (modesParam.split(',') as TransportMode[]) : undefined,
    dateTime: dateTime || undefined,
    arriveBy: arriveBy || undefined,
    bannedTrips: bannedTrips || undefined,
  })

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status || 502 })
  }

  return NextResponse.json({ routes: result.routes, notice: result.notice })
}
