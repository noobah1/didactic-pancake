import { estimateCitySegments } from '../city-estimate'
import { FlowReading } from '../tomtom'
import { Segment } from '../estimate'
import { CITY_PROBE_SETS, getProbe } from '../city-probes'

const NOW = 1_000_000_000

function flow(overrides: Partial<FlowReading> = {}): FlowReading {
  return { probeId: 'P1', currentKmh: 40, freeFlowKmh: 40, confidence: 0.9, measuredAt: NOW, ...overrides }
}

// A segment the timetable expects to be covered at 30 km/h: 2500m in 300s.
function segment(overrides: Partial<Segment> = {}): Segment {
  return { inMotionSec: 300, distanceM: 2_500, detectorId: 'P1', ...overrides }
}

describe('estimateCitySegments', () => {
  it('reports the extra time traffic at half the scheduled speed costs the route', () => {
    const segments = [segment(), segment(), segment()]
    const readings = new Map([['P1', flow({ currentKmh: 15 })]])

    const result = estimateCitySegments(segments, readings, NOW)

    // Scheduled 30 km/h, traffic 15 -> each segment takes twice as long, so
    // each costs its own in-motion time again.
    expect(result?.minSeconds).toBe(900)
    expect(result?.detectorCount).toBe(1)
    expect(result?.coveredFraction).toBe(1)
  })

  it('reports nothing when traffic is merely below free-flow but still at schedule speed', () => {
    // The bias this estimator exists to avoid. A city street posted at 50 and
    // running at 35 is a completely ordinary weekday — and a bus scheduled to
    // average 30 km/h on it is not losing a second. Comparing against
    // TomTom's free-flow speed instead would claim ~5 minutes here, all day,
    // every day.
    const segments = [segment(), segment(), segment()]
    const readings = new Map([['P1', flow({ currentKmh: 35, freeFlowKmh: 50 })]])

    expect(estimateCitySegments(segments, readings, NOW)).toBeNull()
  })

  it('reports a single number rather than a range, unlike the detector pipeline', () => {
    // A Tark Tee detector reports two directions with nothing tying either to
    // the bus's direction of travel, so estimate.ts has to publish a spread.
    // A probe reading is one measurement of one matched segment — pretending
    // it bounds a range would invent uncertainty that isn't there.
    const segments = [segment({ inMotionSec: 900, distanceM: 7_500 })]
    const readings = new Map([['P1', flow({ currentKmh: 15 })]])

    const result = estimateCitySegments(segments, readings, NOW)

    expect(result?.minSeconds).toBe(result?.maxSeconds)
  })

  it('suppresses a route whose probes only speak for a minority of its running time', () => {
    // 200s covered out of 1000s total = 0.2, below MIN_COVERED_FRACTION.
    const segments = [
      segment({ inMotionSec: 200, distanceM: 1_600 }),
      segment({ inMotionSec: 800, detectorId: null }),
    ]
    const readings = new Map([['P1', flow({ currentKmh: 5 })]])

    expect(estimateCitySegments(segments, readings, NOW)).toBeNull()
  })

  it('suppresses a slowdown too small to be more than ordinary traffic variance', () => {
    // Scheduled 30 km/h, traffic 27 -> 600s becomes ~667s, a 67s cost, under
    // TRAFFIC_ESTIMATE_THRESHOLD_SEC.
    const segments = [segment({ inMotionSec: 600, distanceM: 5_000 })]
    const readings = new Map([['P1', flow({ currentKmh: 27 })]])

    expect(estimateCitySegments(segments, readings, NOW)).toBeNull()
  })

  it('drops a reading that has aged past MAX_READING_AGE_MS instead of treating it as current', () => {
    // The budget guard can leave a probe unrefreshed for a long time; an
    // estimate built on a half-hour-old reading would be a confident number
    // about traffic nobody has looked at since.
    const segments = [segment({ inMotionSec: 900, distanceM: 7_500 })]
    const readings = new Map([['P1', flow({ currentKmh: 10, measuredAt: NOW - 30 * 60_000 })]])

    expect(estimateCitySegments(segments, readings, NOW)).toBeNull()
  })

  it('clamps a near-stopped probe rather than extrapolating it across the route', () => {
    const segments = [segment({ inMotionSec: 600, distanceM: 5_000 })]
    // Scheduled 30 km/h against 2 km/h traffic is a raw ratio of 15, which
    // must clamp to MAX_SLOWDOWN_FACTOR (3).
    const readings = new Map([['P1', flow({ currentKmh: 2 })]])

    expect(estimateCitySegments(segments, readings, NOW)?.minSeconds).toBe(600 * 2)
  })

  it('never reports a route as faster than scheduled when the road is running free', () => {
    // Buses have their own dwell/boarding time that empty roads don't speed
    // up; a negative "delay" would be a claim this signal can't support.
    const segments = [segment({ inMotionSec: 900, distanceM: 7_500 })]
    const readings = new Map([['P1', flow({ currentKmh: 70 })]])

    expect(estimateCitySegments(segments, readings, NOW)).toBeNull()
  })

  it('skips a segment with no distance rather than dividing by a missing number', () => {
    const segments = [segment({ distanceM: undefined })]
    const readings = new Map([['P1', flow({ currentKmh: 5 })]])

    expect(estimateCitySegments(segments, readings, NOW)).toBeNull()
  })

  it('ignores a segment whose probe has no reading at all, without crediting it as covered', () => {
    const segments = [
      segment({ inMotionSec: 500, distanceM: 4_000 }),
      segment({ inMotionSec: 500, distanceM: 4_000, detectorId: 'P2' }),
    ]
    // P1 reads half the scheduled 28.8 km/h; P2 has no reading at all.
    const readings = new Map([['P1', flow({ currentKmh: 14.4 })]])

    const result = estimateCitySegments(segments, readings, NOW)

    expect(result?.coveredFraction).toBe(0.5)
    expect(result?.minSeconds).toBe(500)
  })
})

describe('city-probes.json', () => {
  it('covers the cities that have no live vehicle feed of their own', () => {
    // The whole point of the feature: Tallinn already has GPS, these don't.
    const ids = CITY_PROBE_SETS.map((c) => c.cityId)
    for (const city of ['tartu', 'narva', 'parnu', 'kohtla-jarve', 'viljandi', 'rakvere']) {
      expect(ids).toContain(city)
    }
  })

  it('gives every route at least two probes, so no single point speaks for a whole line', () => {
    for (const set of CITY_PROBE_SETS) {
      for (const route of set.routes) {
        expect(route.probeIds.length).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('references only probes that exist, and only within the route’s own city', () => {
    for (const set of CITY_PROBE_SETS) {
      const own = new Set(set.probes.map((p) => p.id))
      for (const route of set.routes) {
        for (const probeId of route.probeIds) {
          expect(getProbe(probeId)).toBeDefined()
          expect(own.has(probeId)).toBe(true)
        }
      }
    }
  })

  it('keeps the per-refresh request count small enough to live inside a free tier', () => {
    // Every probe is one metered request per CITY_FLOW_CACHE_TTL. If a
    // regenerated file ever balloons this, the cost shows up as a surprise
    // bill rather than a failing build — so assert it here.
    const total = CITY_PROBE_SETS.reduce((sum, c) => sum + c.probes.length, 0)
    expect(total).toBeLessThanOrEqual(150)
  })
})
