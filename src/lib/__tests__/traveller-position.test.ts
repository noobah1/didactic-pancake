import { resolveTravellerPosition, FRESH_GPS_MAX_AGE_MS, JOURNEY_END_GRACE_MS } from '../traveller-position'
import { RouteLeg, RouteResult, SharePosition, VehiclePosition } from '../types'
import { DelayedVehicle } from '@/app/api/delays/route'

const LEG_START = '2026-08-20T08:00:00Z'
const LEG_END = '2026-08-20T08:20:00Z' // 20-minute leg
const MID_LEG_MS = new Date('2026-08-20T08:10:00Z').getTime() // 10 min in

function transitLeg(overrides: Partial<RouteLeg> = {}): RouteLeg {
  return {
    mode: 'bus',
    from: { name: 'A', lat: 59.4, lng: 24.7 },
    to: { name: 'B', lat: 59.42, lng: 24.72 },
    startTime: LEG_START,
    endTime: LEG_END,
    duration: 1200,
    route: '5',
    tripId: 'trip-1',
    ...overrides,
  }
}

function route(legs: RouteLeg[] = [transitLeg()], overrides: Partial<RouteResult> = {}): RouteResult {
  return {
    id: 'r1',
    legs,
    duration: 1200,
    startTime: LEG_START,
    endTime: LEG_END,
    walkDistance: 0,
    ...overrides,
  }
}

function position(overrides: Partial<SharePosition> = {}): SharePosition {
  return { lat: 1, lng: 2, updatedAt: MID_LEG_MS - 10_000, ...overrides }
}

function delayedVehicle(overrides: Partial<DelayedVehicle> = {}): DelayedVehicle {
  return {
    vehicleId: 'v1',
    tripId: 'trip-1',
    line: '5',
    mode: 'bus',
    destination: 'B',
    delaySeconds: 0,
    lat: 59.41,
    lng: 24.71,
    heading: 90,
    ...overrides,
  }
}

describe('resolveTravellerPosition', () => {
  it('returns null when there is no position and sharing was never turned on', () => {
    const result = resolveTravellerPosition({
      route: route(),
      position: null,
      sharing: false,
      nowMs: MID_LEG_MS,
    })
    expect(result).toBeNull()
  })

  it('trusts a fix younger than FRESH_GPS_MAX_AGE_MS as a real GPS position', () => {
    const pos = position({ updatedAt: MID_LEG_MS - 10_000 })
    expect(new Date(MID_LEG_MS).getTime() - pos.updatedAt).toBeLessThan(FRESH_GPS_MAX_AGE_MS)
    const result = resolveTravellerPosition({
      route: route(),
      position: pos,
      sharing: true,
      nowMs: MID_LEG_MS,
    })
    expect(result).toEqual({ lat: pos.lat, lng: pos.lng, source: 'gps', label: 'Live', ageMs: 10_000 })
  })

  it('falls back to the live vehicle running the current leg once the fix goes stale', () => {
    const pos = position({ updatedAt: MID_LEG_MS - 5 * 60_000 }) // 5 min old — past FRESH_GPS_MAX_AGE_MS
    const vehicle = delayedVehicle()
    const result = resolveTravellerPosition({
      route: route(),
      position: pos,
      sharing: true,
      delayVehicles: [vehicle],
      nowMs: MID_LEG_MS,
    })
    expect(result).toMatchObject({
      lat: vehicle.lat,
      lng: vehicle.lng,
      source: 'vehicle',
      mode: 'bus',
    })
    expect(result?.label).toContain('5')
    expect(result?.label.toLowerCase()).toContain('estimated')
  })

  it('falls back to the timetable when no live vehicle can be matched to the current leg', () => {
    const pos = position({ updatedAt: MID_LEG_MS - 5 * 60_000 })
    const result = resolveTravellerPosition({
      route: route(),
      position: pos,
      sharing: true,
      delayVehicles: [],
      vehicles: [],
      nowMs: MID_LEG_MS,
    })
    expect(result?.source).toBe('schedule')
    expect(result?.label).toBe('Estimated from timetable')
  })

  it('never infers a vehicle/schedule position once the owner has turned sharing off, even with a matching live vehicle available', () => {
    const pos = position({ updatedAt: MID_LEG_MS - 5 * 60_000 })
    const result = resolveTravellerPosition({
      route: route(),
      position: pos,
      sharing: false,
      delayVehicles: [delayedVehicle()],
      nowMs: MID_LEG_MS,
    })
    expect(result?.source).not.toBe('vehicle')
    expect(result?.source).not.toBe('schedule')
    expect(result?.source).toBe('stale')
    expect(result?.label).toContain('Last seen')
  })

  it('falls back to the last real fix, labelled as stale, once the journey (plus grace) has ended', () => {
    const journeyEndMs = new Date(LEG_END).getTime()
    const pastGraceMs = journeyEndMs + JOURNEY_END_GRACE_MS + 60_000
    // Older than FRESH_GPS_MAX_AGE_MS so the (higher-priority) gps tier
    // doesn't win regardless of how far past grace nowMs is — this test is
    // specifically about the grace cutoff blocking inference, not about
    // fix freshness.
    const pos = position({ updatedAt: pastGraceMs - 5 * 60_000 })
    const result = resolveTravellerPosition({
      route: route(),
      position: pos,
      sharing: true,
      delayVehicles: [delayedVehicle()],
      nowMs: pastGraceMs,
    })
    expect(result?.source).toBe('stale')
  })

  it('returns null when sharing was turned off and no fix was ever recorded', () => {
    const result = resolveTravellerPosition({
      route: route(),
      position: null,
      sharing: false,
      nowMs: MID_LEG_MS,
    })
    expect(result).toBeNull()
  })

  it('picks the first not-yet-finished leg as current, skipping a completed earlier leg', () => {
    const firstLeg = transitLeg({
      mode: 'walk',
      tripId: undefined,
      route: undefined,
      startTime: '2026-08-20T07:50:00Z',
      endTime: '2026-08-20T07:58:00Z',
      from: { name: 'Start', lat: 59.39, lng: 24.69 },
      to: { name: 'A', lat: 59.4, lng: 24.7 },
    })
    const secondLeg = transitLeg({ tripId: 'trip-2' })
    const vehicleOnSecondLeg: VehiclePosition = {
      id: 'sched-2',
      mode: 'bus',
      line: '5',
      lat: 59.415,
      lng: 24.715,
      heading: 90,
      destination: 'B',
    }
    const pos = position({ updatedAt: MID_LEG_MS - 5 * 60_000 })
    const result = resolveTravellerPosition({
      route: route([firstLeg, secondLeg]),
      position: pos,
      sharing: true,
      delayVehicles: [],
      vehicles: [{ ...vehicleOnSecondLeg, id: 'trip-2' }],
      nowMs: MID_LEG_MS, // inside secondLeg's window, after firstLeg already ended
    })
    expect(result?.source).toBe('vehicle')
    expect(result).toMatchObject({ lat: vehicleOnSecondLeg.lat, lng: vehicleOnSecondLeg.lng })
  })
})
