import { LegPlace } from './types'

export interface GqlTime {
  scheduledTime: string
  estimated?: { time: string } | null
}

export interface GqlPlace {
  name?: string
  lat: number
  lon: number
  stop?: { gtfsId: string } | null
  departure?: GqlTime | null
  arrival?: GqlTime | null
}

export function resolveTime(t: GqlTime): string {
  return t.estimated?.time || t.scheduledTime
}

export function mapPlace(place: GqlPlace): LegPlace {
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
