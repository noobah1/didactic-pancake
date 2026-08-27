import { ridingProgress, ALIGHT_ALARM_RADIUS_M } from '../riding-progress'
import { RouteLeg, LegPlace } from '../types'

// Degrees-of-latitude offset for a given number of metres north of LAT0,
// holding longitude fixed — keeps every fixture on one straight line so
// distances are easy to reason about (haversine along a meridian is close
// enough to linear at this scale for test purposes).
const LAT0 = 59.4
const LNG0 = 24.7
const M_PER_DEG_LAT = 111_320
function stopAt(name: string, metersFromOrigin: number): LegPlace {
  return { name, lat: LAT0 + metersFromOrigin / M_PER_DEG_LAT, lng: LNG0 }
}
function fixAt(metersFromOrigin: number): { lat: number; lng: number } {
  return { lat: LAT0 + metersFromOrigin / M_PER_DEG_LAT, lng: LNG0 }
}

// from=0m, S1=1000m, S2=2000m, to=3000m — no legGeometry, so ridingProgress
// falls back to the stops themselves as the route shape.
function legWithStops(overrides: Partial<RouteLeg> = {}): RouteLeg {
  return {
    mode: 'bus',
    from: stopAt('From', 0),
    to: stopAt('To', 3000),
    startTime: '2026-08-20T08:00:00Z',
    endTime: '2026-08-20T08:20:00Z',
    duration: 1200,
    route: '5',
    tripId: 'trip-1',
    intermediateStops: [stopAt('S1', 1000), stopAt('S2', 2000)],
    ...overrides,
  }
}

describe('ridingProgress', () => {
  it('picks the first stop as next when the fix is still near the boarding stop', () => {
    const p = ridingProgress(legWithStops(), fixAt(0))
    expect(p.nextStop.name).toBe('S1')
    expect(p.stopsRemaining).toBe(3) // S1, S2, To
    expect(Math.abs(p.distanceToNextStopM - 1000)).toBeLessThan(3)
  })

  it('advances to the following stop once the fix is past the current one', () => {
    const p = ridingProgress(legWithStops(), fixAt(1200))
    expect(p.nextStop.name).toBe('S2')
    expect(p.stopsRemaining).toBe(2) // S2, To
  })

  it('reports the alight stop as next once nothing else is left', () => {
    const p = ridingProgress(legWithStops(), fixAt(2500))
    expect(p.nextStop.name).toBe('To')
    expect(p.stopsRemaining).toBe(1)
  })

  it('handles a leg with no intermediate stops at all — always "To" is next', () => {
    const leg = legWithStops({ intermediateStops: undefined, to: stopAt('To', 500) })
    const p = ridingProgress(leg, fixAt(0))
    expect(p.nextStop.name).toBe('To')
    expect(p.stopsRemaining).toBe(1)
  })

  it('resolves the correct stop on the very first fix even when riding mode starts mid-leg', () => {
    // Rider only opens the app once already between S1 and S2 — no prior
    // call, no passed-stop bookkeeping, just this one fix.
    const p = ridingProgress(legWithStops(), fixAt(1500))
    expect(p.nextStop.name).toBe('S2')
  })

  it('does not fire the alarm just outside the alight radius', () => {
    const p = ridingProgress(legWithStops(), fixAt(3000 - ALIGHT_ALARM_RADIUS_M - 1))
    expect(p.distanceToAlightM).toBeGreaterThan(ALIGHT_ALARM_RADIUS_M)
    expect(p.shouldAlarm).toBe(false)
  })

  it('fires the alarm exactly at the alight radius', () => {
    const p = ridingProgress(legWithStops(), fixAt(3000 - ALIGHT_ALARM_RADIUS_M))
    expect(Math.abs(p.distanceToAlightM - ALIGHT_ALARM_RADIUS_M)).toBeLessThan(3)
    expect(p.shouldAlarm).toBe(true)
  })

  it('fires the alarm once at/past the alight stop', () => {
    const p = ridingProgress(legWithStops(), fixAt(3000))
    expect(p.shouldAlarm).toBe(true)
    expect(p.distanceToAlightM).toBeLessThan(3)
  })

  it('is independent of the leg schedule — a fix implying the ride is running well ahead of or behind its timetable still resolves from position alone', () => {
    const early = legWithStops({
      startTime: '2026-08-20T08:00:00Z',
      endTime: '2026-08-20T08:20:00Z',
    })
    const late = legWithStops({
      startTime: '2026-01-01T00:00:00Z',
      endTime: '2026-01-01T00:05:00Z',
    })
    const fix = fixAt(2500)
    expect(ridingProgress(early, fix).nextStop.name).toBe(ridingProgress(late, fix).nextStop.name)
    expect(ridingProgress(early, fix).nextStop.name).toBe('To')
  })
})
