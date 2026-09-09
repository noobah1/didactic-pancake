import { mapDeparture, mapWheelchairBoarding, GqlStoptime } from '../stop-departures'

// serviceDay is epoch seconds at *local* (Europe/Tallinn) midnight for the service
// day, not UTC midnight — 1788901200 is 2026-09-08T21:00:00Z, i.e. 2026-09-09T00:00
// Tallinn time (UTC+3 in September). Verified against a live OTP query during
// development: serviceDay 1788901200 + offset 73860 resolved to a real departure
// that peatus.ee/the OTP instance itself reported as 20:31 Tallinn time.
function stoptime(overrides: Partial<GqlStoptime>): GqlStoptime {
  return {
    serviceDay: 1788901200,
    scheduledDeparture: 73860, // 20:31:00 into the service day
    realtimeDeparture: 73860,
    realtime: false,
    headsign: 'Priisle',
    trip: { gtfsId: '1:30183', route: { shortName: '63', mode: 'BUS' } },
    ...overrides,
  }
}

describe('mapDeparture', () => {
  it('resolves a same-day departure to serviceDay + offset', () => {
    const dep = mapDeparture(stoptime({}))
    expect(dep?.departure).toBe((1788901200 + 73860) * 1000)
    expect(new Date(dep!.departure).toISOString()).toBe('2026-09-09T17:31:00.000Z')
  })

  it('resolves a past-midnight departure (offset >= 86400) correctly', () => {
    // GTFS represents a trip that departs at 00:45 "the next day" as still
    // belonging to the earlier service day, with an offset past 86400 —
    // this is the classic case that breaks a naive `offset % 86400` clock read.
    const pastMidnightOffset = 86400 + 45 * 60 // 00:45 the following calendar day
    const dep = mapDeparture(stoptime({ scheduledDeparture: pastMidnightOffset, realtimeDeparture: pastMidnightOffset }))

    expect(dep?.departure).toBe((1788901200 + pastMidnightOffset) * 1000)
    // A naive `offset % 86400` read would wrongly land back on 00:45 the *same*
    // service day instead of rolling into the next calendar day.
    expect(new Date(dep!.departure).toISOString()).toBe('2026-09-09T21:45:00.000Z')
  })

  it('uses the realtime offset for departure when realtime data is present', () => {
    const dep = mapDeparture(stoptime({ realtime: true, realtimeDeparture: 73920, scheduledDeparture: 73860 }))
    expect(dep?.departure).toBe((1788901200 + 73920) * 1000)
    // scheduledDeparture on the mapped result always reflects the schedule, not realtime
    expect(dep?.scheduledDeparture).toBe((1788901200 + 73860) * 1000)
  })

  it('computes delaySeconds only when realtime, and only from the realtime/scheduled gap', () => {
    const onTime = mapDeparture(stoptime({ realtime: false }))
    expect(onTime?.delaySeconds).toBe(0)

    const late = mapDeparture(stoptime({ realtime: true, scheduledDeparture: 73860, realtimeDeparture: 74160 }))
    expect(late?.delaySeconds).toBe(300)
  })

  it('a past-midnight departure keeps correct delay math too', () => {
    const scheduled = 86400 + 45 * 60
    const realtime = scheduled + 180
    const dep = mapDeparture(stoptime({ realtime: true, scheduledDeparture: scheduled, realtimeDeparture: realtime }))
    expect(dep?.delaySeconds).toBe(180)
    expect(new Date(dep!.departure).toISOString()).toBe('2026-09-09T21:48:00.000Z')
  })

  it('returns null when the stoptime has no trip', () => {
    expect(mapDeparture(stoptime({ trip: null }))).toBeNull()
  })

  it('falls back to empty headsign and bus mode when data is missing', () => {
    const dep = mapDeparture(stoptime({ headsign: null, trip: { gtfsId: '1:1', route: null } }))
    expect(dep?.headsign).toBe('')
    expect(dep?.mode).toBe('bus')
    expect(dep?.line).toBe('')
  })
})

describe('mapWheelchairBoarding', () => {
  it('passes through POSSIBLE and NOT_POSSIBLE', () => {
    expect(mapWheelchairBoarding('POSSIBLE')).toBe('POSSIBLE')
    expect(mapWheelchairBoarding('NOT_POSSIBLE')).toBe('NOT_POSSIBLE')
  })

  it('defaults anything else, including missing data, to NO_INFORMATION', () => {
    expect(mapWheelchairBoarding('NO_INFORMATION')).toBe('NO_INFORMATION')
    expect(mapWheelchairBoarding(undefined)).toBe('NO_INFORMATION')
    expect(mapWheelchairBoarding(null)).toBe('NO_INFORMATION')
    expect(mapWheelchairBoarding('garbage')).toBe('NO_INFORMATION')
  })
})
