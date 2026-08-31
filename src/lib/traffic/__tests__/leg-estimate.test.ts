import { legSegments, legStops, estimateLeg, LegStopTiming } from '../leg-estimate'
import { DetectorReading } from '../detectors'
import { FlowReading } from '../tomtom'
import { MAX_READING_AGE_MS } from '../../constants'

const NOW = 1_000_000_000

// A route in ROUTE_COVERAGE (route-coverage.json) — "189" Tallinn-Tartu-
// Põlva-Võru — whose nearest detector is CA00002045 at Kose-Risti
// (distanceMeters: 0 in the coverage file itself).
const DETECTOR_ROUTE_ID = '1:7396646ab7496bb5923d5799871317c0'
const DETECTOR_ID = 'CA00002045'
const DETECTOR_LAT = 59.151207
const DETECTOR_LON = 25.22033

// A route in CITY_PROBE_SETS (city-probes.json) — Tallinn's "116C" — served
// by probe tallinn-1.
const CITY_ROUTE_ID = '1:d339a3570f92545cd7b65dc8ee7f6bb7'
const PROBE_ID = 'tallinn-1'
const PROBE_LAT = 59.432991
const PROBE_LON = 24.74838

const UNCOVERED_ROUTE_ID = 'not-a-real-route'

function detectorReading(overrides: Partial<DetectorReading> = {}): DetectorReading {
  return {
    detectorId: DETECTOR_ID,
    measuredAt: NOW,
    forwards: { avgSpeedKmh: 45, relativeSpeed: 2, flow: 50 },
    backwards: { avgSpeedKmh: 45, relativeSpeed: 2, flow: 50 },
    ...overrides,
  }
}

function flowReading(overrides: Partial<FlowReading> = {}): FlowReading {
  return { probeId: PROBE_ID, currentKmh: 10, freeFlowKmh: 50, confidence: 0.9, measuredAt: NOW, ...overrides }
}

describe('legSegments', () => {
  it('builds consecutive stop-to-stop segments from scheduled times', () => {
    const stops: LegStopTiming[] = [
      { lat: 59.0, lng: 25.0, scheduledDeparture: '2026-08-31T10:00:00Z' },
      { lat: 59.1, lng: 25.1, scheduledArrival: '2026-08-31T10:05:00Z', scheduledDeparture: '2026-08-31T10:05:30Z' },
      { lat: 59.2, lng: 25.2, scheduledArrival: '2026-08-31T10:12:00Z' },
    ]

    const segments = legSegments(stops)

    expect(segments).toHaveLength(2)
    expect(segments[0].inMotionSec).toBe(300) // 10:00 -> 10:05
    expect(segments[1].inMotionSec).toBe(390) // 10:05:30 -> 10:12
  })

  it('drops a segment missing either endpoint\'s scheduled time', () => {
    const stops: LegStopTiming[] = [
      { lat: 59.0, lng: 25.0 }, // no scheduledDeparture
      { lat: 59.1, lng: 25.1, scheduledArrival: '2026-08-31T10:05:00Z', scheduledDeparture: '2026-08-31T10:05:00Z' },
      { lat: 59.2, lng: 25.2, scheduledArrival: '2026-08-31T10:10:00Z' },
    ]

    const segments = legSegments(stops)

    expect(segments).toHaveLength(1)
    expect(segments[0].inMotionSec).toBe(300)
  })

  it('drops a non-positive gap rather than emitting a negative-duration segment', () => {
    const stops: LegStopTiming[] = [
      { lat: 59.0, lng: 25.0, scheduledDeparture: '2026-08-31T10:05:00Z' },
      { lat: 59.1, lng: 25.1, scheduledArrival: '2026-08-31T10:00:00Z' }, // arrives before departure
    ]

    expect(legSegments(stops)).toHaveLength(0)
  })

  it('returns no segments for a single-stop leg', () => {
    const stops: LegStopTiming[] = [{ lat: 59.0, lng: 25.0, scheduledDeparture: '2026-08-31T10:00:00Z' }]
    expect(legSegments(stops)).toHaveLength(0)
  })
})

describe('legStops', () => {
  it('orders from, every intermediate stop, then to', () => {
    const from: LegStopTiming = { lat: 1, lng: 1 }
    const mid: LegStopTiming = { lat: 2, lng: 2 }
    const to: LegStopTiming = { lat: 3, lng: 3 }

    expect(legStops(from, [mid], to)).toEqual([from, mid, to])
  })

  it('handles a leg with no intermediate stops', () => {
    const from: LegStopTiming = { lat: 1, lng: 1 }
    const to: LegStopTiming = { lat: 3, lng: 3 }
    expect(legStops(from, undefined, to)).toEqual([from, to])
  })
})

describe('estimateLeg', () => {
  it('returns null immediately for an empty segment list', () => {
    expect(estimateLeg(DETECTOR_ROUTE_ID, [], new Map(), new Map(), new Map(), NOW)).toBeNull()
  })

  it('returns null for a route covered by neither the detector nor the probe pipeline', () => {
    const segments = [{ fromLat: DETECTOR_LAT, fromLon: DETECTOR_LON, toLat: DETECTOR_LAT + 0.01, toLon: DETECTOR_LON, inMotionSec: 600 }]
    const readings = new Map([[DETECTOR_ID, detectorReading()]])
    const baselines = new Map([[`${DETECTOR_ID}|forwards`, 90], [`${DETECTOR_ID}|backwards`, 90]])

    expect(estimateLeg(UNCOVERED_ROUTE_ID, segments, readings, baselines, new Map(), NOW)).toBeNull()
  })

  describe('a route covered by Tark Tee detectors', () => {
    it('reports a slowdown when the nearest detector reads well under baseline', () => {
      const segments = [
        { fromLat: DETECTOR_LAT, fromLon: DETECTOR_LON, toLat: DETECTOR_LAT + 0.01, toLon: DETECTOR_LON, inMotionSec: 600 },
      ]
      const readings = new Map([[DETECTOR_ID, detectorReading()]])
      const baselines = new Map([[`${DETECTOR_ID}|forwards`, 90], [`${DETECTOR_ID}|backwards`, 90]])

      const estimate = estimateLeg(DETECTOR_ROUTE_ID, segments, readings, baselines, new Map(), NOW)

      expect(estimate).not.toBeNull()
      expect(estimate!.evidence).toBe('traffic-estimate')
      // baseline 90, reading 45 -> ratio 2 -> excess = inMotionSec * (2-1)
      expect(estimate!.minSeconds).toBeCloseTo(600, 5)
    })

    it('returns null when the reading is too stale to trust', () => {
      const segments = [
        { fromLat: DETECTOR_LAT, fromLon: DETECTOR_LON, toLat: DETECTOR_LAT + 0.01, toLon: DETECTOR_LON, inMotionSec: 600 },
      ]
      const readings = new Map([[DETECTOR_ID, detectorReading({ measuredAt: NOW - MAX_READING_AGE_MS - 1 })]])
      const baselines = new Map([[`${DETECTOR_ID}|forwards`, 90], [`${DETECTOR_ID}|backwards`, 90]])

      expect(estimateLeg(DETECTOR_ROUTE_ID, segments, readings, baselines, new Map(), NOW)).toBeNull()
    })

    it('returns null when the covered fraction of the leg is below MIN_COVERED_FRACTION', () => {
      // One short segment near the detector, plus a much longer segment far
      // from any of this route's detectors — the detector speaks for only a
      // small slice of the leg's total in-motion time.
      const segments = [
        { fromLat: DETECTOR_LAT, fromLon: DETECTOR_LON, toLat: DETECTOR_LAT + 0.01, toLon: DETECTOR_LON, inMotionSec: 100 },
        { fromLat: 10, fromLon: 10, toLat: 10.01, toLon: 10, inMotionSec: 5_000 }, // nowhere near Estonia
      ]
      const readings = new Map([[DETECTOR_ID, detectorReading()]])
      const baselines = new Map([[`${DETECTOR_ID}|forwards`, 90], [`${DETECTOR_ID}|backwards`, 90]])

      expect(estimateLeg(DETECTOR_ROUTE_ID, segments, readings, baselines, new Map(), NOW)).toBeNull()
    })
  })

  describe('a route covered by TomTom city probes', () => {
    it('reports a slowdown when the probe reads well under the timetable-implied speed', () => {
      // ~3.3km in 300s -> timetable implies ~40 km/h; the probe below reads
      // 10 km/h, well under it.
      const segments = [
        { fromLat: PROBE_LAT, fromLon: PROBE_LON, toLat: PROBE_LAT + 0.03, toLon: PROBE_LON, inMotionSec: 300 },
      ]
      const flowReadings = new Map([[PROBE_ID, flowReading()]])

      const estimate = estimateLeg(CITY_ROUTE_ID, segments, new Map(), new Map(), flowReadings, NOW)

      expect(estimate).not.toBeNull()
      expect(estimate!.evidence).toBe('traffic-estimate')
      // City pipeline never splits by direction — always a single number.
      expect(estimate!.minSeconds).toBe(estimate!.maxSeconds)
    })
  })

  it('scopes the excess to exactly the segments handed to it — the fix this ships for', () => {
    // The whole point of leg-scoped estimation: a short leg (one segment)
    // near a slow detector reports the slowdown for THAT segment alone, not
    // whatever a route-level pipeline would compute from a whole
    // representative trip spanning many more (here, uncovered) kilometres.
    const shortLeg = [
      { fromLat: DETECTOR_LAT, fromLon: DETECTOR_LON, toLat: DETECTOR_LAT + 0.01, toLon: DETECTOR_LON, inMotionSec: 600 },
    ]
    const readings = new Map([[DETECTOR_ID, detectorReading()]])
    const baselines = new Map([[`${DETECTOR_ID}|forwards`, 90], [`${DETECTOR_ID}|backwards`, 90]])

    const shortEstimate = estimateLeg(DETECTOR_ROUTE_ID, shortLeg, readings, baselines, new Map(), NOW)

    const longLeg = [
      ...shortLeg,
      // A large uncovered stretch appended, as if this were the rest of a
      // long intercity corridor — must not inflate the estimate above what
      // the covered segment alone accounts for, and coveredFraction must
      // reflect the dilution.
      { fromLat: 10, fromLon: 10, toLat: 10.01, toLon: 10, inMotionSec: 10_000 },
    ]
    // With that much uncovered time added, coverage drops below
    // MIN_COVERED_FRACTION and the estimate disappears entirely — proving
    // the excess is computed from the leg's own segments, not the whole
    // route's schedule.
    const longEstimate = estimateLeg(DETECTOR_ROUTE_ID, longLeg, readings, baselines, new Map(), NOW)

    expect(shortEstimate).not.toBeNull()
    expect(longEstimate).toBeNull()
  })
})
