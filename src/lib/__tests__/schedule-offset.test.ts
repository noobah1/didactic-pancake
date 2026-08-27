import {
  scheduledTimeAtPosition,
  measureOffsetSec,
  decayOffsetSec,
  OffsetStoptime,
  OFFSET_DECAY_TAU_SEC,
  OFFSET_MAX_AGE_SEC,
} from '../schedule-offset'

// Same fixture convention as riding-progress.test.ts: a straight north-south
// line so distance-along-shape is easy to reason about, three stops 1000m
// apart, each due at a round number of schedule seconds.
const LAT0 = 59.4
const LNG0 = 24.7
const M_PER_DEG_LAT = 111_320
function fixAt(metersFromOrigin: number): { lat: number; lng: number } {
  return { lat: LAT0 + metersFromOrigin / M_PER_DEG_LAT, lng: LNG0 }
}
function stoptimeAt(metersFromOrigin: number, scheduledSec: number): OffsetStoptime {
  const { lat, lng } = fixAt(metersFromOrigin)
  return {
    scheduledDeparture: scheduledSec,
    scheduledArrival: scheduledSec,
    stop: { lat, lon: lng },
  }
}

// Stop A at 0m/08:00:00 (28800s), stop B at 1000m/08:05:00 (29100s),
// stop C at 2000m/08:10:00 (29400s) — a steady 5 min/km, no shape (falls
// back to straight lines between stops, same as scheduledTimeAtPosition's
// own no-shape path).
function threeStopSchedule(): OffsetStoptime[] {
  return [stoptimeAt(0, 28800), stoptimeAt(1000, 29100), stoptimeAt(2000, 29400)]
}

describe('scheduledTimeAtPosition', () => {
  it('returns the exact stop time when the fix sits on a stop', () => {
    expect(scheduledTimeAtPosition(threeStopSchedule(), null, fixAt(1000).lat, fixAt(1000).lng)).toBe(29100)
  })

  it('interpolates linearly between two stops', () => {
    const t = scheduledTimeAtPosition(threeStopSchedule(), null, fixAt(500).lat, fixAt(500).lng)
    expect(t).not.toBeNull()
    expect(t!).toBeCloseTo(28950, 0) // halfway between 28800 and 29100
  })

  it('clamps to the first stop time before the route starts', () => {
    const t = scheduledTimeAtPosition(threeStopSchedule(), null, fixAt(-500).lat, fixAt(-500).lng)
    expect(t).toBe(28800)
  })

  it('clamps to the last stop time past the route end', () => {
    const t = scheduledTimeAtPosition(threeStopSchedule(), null, fixAt(2500).lat, fixAt(2500).lng)
    expect(t).toBe(29400)
  })

  it('returns null with fewer than two stoptimes', () => {
    expect(scheduledTimeAtPosition([stoptimeAt(0, 28800)], null, LAT0, LNG0)).toBeNull()
  })
})

describe('measureOffsetSec', () => {
  it('is positive (late) when observed further behind than the schedule expects', () => {
    // At 500m the schedule expects 28950; observing it there at 29050 is 100s late.
    const offset = measureOffsetSec(threeStopSchedule(), null, fixAt(500).lat, fixAt(500).lng, 29050)
    expect(offset).not.toBeNull()
    expect(offset!).toBeCloseTo(100, 0)
  })

  it('is negative (early) when observed ahead of the schedule', () => {
    const offset = measureOffsetSec(threeStopSchedule(), null, fixAt(500).lat, fixAt(500).lng, 28900)
    expect(offset).not.toBeNull()
    expect(offset!).toBeCloseTo(-50, 0)
  })

  it('is ~0 exactly on schedule', () => {
    const offset = measureOffsetSec(threeStopSchedule(), null, fixAt(1000).lat, fixAt(1000).lng, 29100)
    expect(offset).not.toBeNull()
    expect(Math.abs(offset!)).toBeLessThan(1)
  })
})

describe('decayOffsetSec', () => {
  it('returns the offset unchanged at age 0', () => {
    expect(decayOffsetSec(300, 0)).toBe(300)
  })

  it('decays toward 0 as age grows, without crossing zero', () => {
    const early = decayOffsetSec(300, 60)
    const later = decayOffsetSec(300, 300)
    expect(early).toBeLessThan(300)
    expect(early).toBeGreaterThan(0)
    expect(later).toBeLessThan(early)
    expect(later).toBeGreaterThan(0)
  })

  it('preserves sign for an early (negative) offset', () => {
    expect(decayOffsetSec(-200, 120)).toBeLessThan(0)
  })

  it('roughly halves every ~0.69*tau (exponential decay)', () => {
    const halfLife = OFFSET_DECAY_TAU_SEC * Math.LN2
    expect(decayOffsetSec(400, halfLife)).toBeCloseTo(200, 0)
  })

  it('is exactly 0 at or past OFFSET_MAX_AGE_SEC', () => {
    expect(decayOffsetSec(300, OFFSET_MAX_AGE_SEC)).toBe(0)
    expect(decayOffsetSec(300, OFFSET_MAX_AGE_SEC + 100)).toBe(0)
  })
})
