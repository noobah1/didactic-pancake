import { priceItinerary } from '../fares/price'
import { RiderProfile } from '../fares/tariffs'
import { RouteResult, RouteLeg } from '../types'

const BASE = new Date('2026-08-27T08:00:00Z').getTime()

function transitLeg(authority: string | undefined, offsetMin: number, durationMin = 20): RouteLeg {
  const start = new Date(BASE + offsetMin * 60_000)
  const end = new Date(BASE + (offsetMin + durationMin) * 60_000)
  return {
    mode: 'bus',
    from: { name: 'A', lat: 0, lng: 0 },
    to: { name: 'B', lat: 0, lng: 0 },
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    duration: durationMin * 60,
    fare: authority ? { authority } : undefined,
  }
}

function walkLeg(offsetMin: number, durationMin = 5): RouteLeg {
  const start = new Date(BASE + offsetMin * 60_000)
  const end = new Date(BASE + (offsetMin + durationMin) * 60_000)
  return {
    mode: 'walk',
    from: { name: 'A', lat: 0, lng: 0 },
    to: { name: 'B', lat: 0, lng: 0 },
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    duration: durationMin * 60,
  }
}

function route(legs: RouteLeg[]): RouteResult {
  return {
    id: 'r',
    legs,
    duration: legs.reduce((s, l) => s + l.duration, 0),
    startTime: legs[0].startTime,
    endTime: legs[legs.length - 1].endTime,
    walkDistance: 0,
  }
}

const adult: RiderProfile = { ageBand: 'adult' }
const youth: RiderProfile = { ageBand: 'youth' }
const senior: RiderProfile = { ageBand: 'senior' }

describe('priceItinerary', () => {
  it('prices a single county leg at the flat adult fare', () => {
    const fare = priceItinerary(route([transitLeg('Tartumaa', 0)]), adult)
    expect(fare.totalCents).toBe(150)
    expect(fare.evidence).toBe('tariff')
    expect(fare.tickets).toHaveLength(1)
  })

  it('combines two county legs boarding within the transfer window into one ticket', () => {
    const fare = priceItinerary(route([transitLeg('Tartumaa', 0), transitLeg('Tartumaa', 30)]), adult)
    expect(fare.totalCents).toBe(150)
    expect(fare.tickets).toHaveLength(1)
  })

  it('charges two separate tickets when the second county leg boards outside the transfer window', () => {
    // Tartumaa's window is 90 minutes (5400s) — 120 minutes apart must not combine.
    const fare = priceItinerary(route([transitLeg('Tartumaa', 0), transitLeg('Tartumaa', 120)]), adult)
    expect(fare.totalCents).toBe(300)
    expect(fare.tickets).toHaveLength(2)
  })

  it('is free for a registered Tallinn resident', () => {
    const profile: RiderProfile = { ageBand: 'adult', residentOf: 'tallinn' }
    const fare = priceItinerary(route([transitLeg('Tallinna linn', 0)]), profile)
    expect(fare.totalCents).toBe(0)
    expect(fare.evidence).toBe('tariff')
  })

  it('charges a non-resident adult the full Tallinn fare', () => {
    const fare = priceItinerary(route([transitLeg('Tallinna linn', 0)]), adult)
    expect(fare.totalCents).toBe(200)
  })

  it('is free for youth and senior riders on county lines', () => {
    expect(priceItinerary(route([transitLeg('Tartumaa', 0)]), youth).totalCents).toBe(0)
    expect(priceItinerary(route([transitLeg('Tartumaa', 0)]), senior).totalCents).toBe(0)
  })

  it('applies the Tartu resident discount only to a registered Tartu resident', () => {
    const resident: RiderProfile = { ageBand: 'adult', residentOf: 'tartu' }
    expect(priceItinerary(route([transitLeg('Tartu linn', 0)]), resident).totalCents).toBe(120)
    expect(priceItinerary(route([transitLeg('Tartu linn', 0)]), adult).totalCents).toBe(180)
  })

  it('prices an Elron leg as a floor, never an exact total', () => {
    const fare = priceItinerary(route([transitLeg('Elron', 0)]), adult)
    expect(fare.evidence).toBe('floor')
    expect(fare.totalCents).toBe(200)
  })

  it('shows no total when the itinerary includes a commercial REM leg', () => {
    const fare = priceItinerary(route([transitLeg('REM', 0)]), adult)
    expect(fare.evidence).toBe('operator')
    expect(fare.totalCents).toBeUndefined()
    expect(fare.tickets[0].cents).toBeUndefined()
  })

  it('reports unknown, not free, for an authority with no tariff row', () => {
    const fare = priceItinerary(route([transitLeg('Narva linn', 0)]), adult)
    expect(fare.evidence).toBe('unknown')
    expect(fare.totalCents).toBeUndefined()
  })

  it('is free for a walk-only itinerary', () => {
    const fare = priceItinerary(route([walkLeg(0)]), adult)
    expect(fare.totalCents).toBe(0)
    expect(fare.evidence).toBe('tariff')
    expect(fare.tickets).toHaveLength(0)
  })

  it('never combines two unmapped-authority legs into one ticket', () => {
    const fare = priceItinerary(route([transitLeg(undefined, 0), transitLeg(undefined, 5)]), adult)
    expect(fare.tickets).toHaveLength(2)
    expect(fare.evidence).toBe('unknown')
  })

  it('downgrades the whole total when a priced leg is mixed with an unpriced one', () => {
    const fare = priceItinerary(route([transitLeg('Tartumaa', 0), transitLeg('REM', 30)]), adult)
    expect(fare.evidence).toBe('operator')
    expect(fare.totalCents).toBeUndefined()
    // The priced ticket is still reported individually even though the total is suppressed.
    expect(fare.tickets.find((t) => t.authority === 'Tartumaa')?.cents).toBe(150)
  })
})
