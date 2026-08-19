import { computeDirectionExcess, estimateSegments, inMotionSeconds, Segment } from '../estimate'
import { DetectorReading } from '../detectors'

const NOW = 1_000_000_000

function reading(overrides: Partial<DetectorReading> = {}): DetectorReading {
  return {
    detectorId: 'D1',
    measuredAt: NOW,
    forwards: { avgSpeedKmh: 90, relativeSpeed: 1, flow: 200 },
    backwards: { avgSpeedKmh: 90, relativeSpeed: 1, flow: 200 },
    ...overrides,
  }
}

describe('inMotionSeconds', () => {
  it('excludes dwell time at either endpoint', () => {
    // Stop A: arrives 1000, departs 1030 (30s dwell). Stop B: arrives 1200.
    // Only the 1030->1200 travel should count, never the dwell before it.
    expect(inMotionSeconds(1030, 1200)).toBe(170)
  })
})

describe('computeDirectionExcess', () => {
  it('produces roughly the full in-motion time as excess when traffic runs at half the baseline speed', () => {
    const segments: Segment[] = [
      { inMotionSec: 300, detectorId: 'D1' },
      { inMotionSec: 300, detectorId: 'D1' },
      { inMotionSec: 300, detectorId: 'D1' },
    ]
    const readings = new Map([['D1', reading({ forwards: { avgSpeedKmh: 45, relativeSpeed: 2, flow: 50 } })]])
    const baselines = new Map([['D1|forwards', 90]])

    const result = computeDirectionExcess(segments, readings, baselines, 'forwards', NOW)

    // ratio = 90/45 = 2 -> excess = inMotionSec * (2-1) = inMotionSec, summed
    // across all three segments.
    expect(result.excessSec).toBeCloseTo(900, 5)
    expect(result.coveredSec).toBe(900)
  })

  it('clamps an extreme slowdown to MAX_SLOWDOWN_FACTOR rather than extrapolating it', () => {
    const segments: Segment[] = [{ inMotionSec: 600, detectorId: 'D1' }]
    // baseline 90, reading 5 -> raw ratio 18, must be clamped to 3.
    const readings = new Map([['D1', reading({ forwards: { avgSpeedKmh: 5, relativeSpeed: 2, flow: 10 } })]])
    const baselines = new Map([['D1|forwards', 90]])

    const result = computeDirectionExcess(segments, readings, baselines, 'forwards', NOW)

    expect(result.excessSec).toBeCloseTo(600 * (3 - 1), 5)
  })

  it('skips a segment whose detector reading is older than MAX_READING_AGE_MS', () => {
    const segments: Segment[] = [{ inMotionSec: 600, detectorId: 'D1' }]
    const staleReading = reading({ measuredAt: NOW - 30 * 60_000 }) // 30 min old
    const readings = new Map([['D1', staleReading]])
    const baselines = new Map([['D1|forwards', 90]])

    const result = computeDirectionExcess(segments, readings, baselines, 'forwards', NOW)

    expect(result.coveredSec).toBe(0)
    expect(result.excessSec).toBe(0)
  })

  it('skips a segment with no assigned detector', () => {
    const segments: Segment[] = [{ inMotionSec: 600, detectorId: null }]
    const result = computeDirectionExcess(segments, new Map(), new Map(), 'forwards', NOW)
    expect(result.coveredSec).toBe(0)
  })

  it('skips a segment whose detector has no learned baseline yet', () => {
    const segments: Segment[] = [{ inMotionSec: 600, detectorId: 'D1' }]
    const readings = new Map([['D1', reading()]])
    const result = computeDirectionExcess(segments, readings, new Map(), 'forwards', NOW)
    expect(result.coveredSec).toBe(0)
  })
})

describe('estimateSegments', () => {
  const evenSegments: Segment[] = [
    { inMotionSec: 600, detectorId: 'D1' },
    { inMotionSec: 600, detectorId: 'D2' },
  ]

  it('returns null when covered fraction is below MIN_COVERED_FRACTION', () => {
    // Only one of many long segments has a detector at all — total in-motion
    // time is dominated by uncovered stretches.
    const segments: Segment[] = [
      { inMotionSec: 600, detectorId: 'D1' },
      { inMotionSec: 5000, detectorId: null },
      { inMotionSec: 5000, detectorId: null },
    ]
    const readings = new Map([['D1', reading({ forwards: { avgSpeedKmh: 30, relativeSpeed: 2, flow: 50 } })]])
    const baselines = new Map([['D1|forwards', 90]])

    expect(estimateSegments(segments, readings, baselines, NOW)).toBeNull()
  })

  it('returns null when every reading is too stale to use', () => {
    const readings = new Map([
      ['D1', reading({ measuredAt: NOW - 25 * 60_000 })],
      ['D2', reading({ measuredAt: NOW - 25 * 60_000 })],
    ])
    const baselines = new Map([
      ['D1|forwards', 90],
      ['D2|forwards', 90],
    ])
    expect(estimateSegments(evenSegments, readings, baselines, NOW)).toBeNull()
  })

  it('returns null when the slowdown is below TRAFFIC_ESTIMATE_THRESHOLD_SEC', () => {
    // Barely slower than baseline — real, but not material.
    const readings = new Map([
      ['D1', reading({ forwards: { avgSpeedKmh: 88, relativeSpeed: 1, flow: 200 }, backwards: { avgSpeedKmh: 88, relativeSpeed: 1, flow: 200 } })],
      ['D2', reading({ forwards: { avgSpeedKmh: 88, relativeSpeed: 1, flow: 200 }, backwards: { avgSpeedKmh: 88, relativeSpeed: 1, flow: 200 } })],
    ])
    const baselines = new Map([
      ['D1|forwards', 90],
      ['D1|backwards', 90],
      ['D2|forwards', 90],
      ['D2|backwards', 90],
    ])
    expect(estimateSegments(evenSegments, readings, baselines, NOW)).toBeNull()
  })

  it('collapses to a single number when traffic is symmetric in both directions', () => {
    const readings = new Map([
      ['D1', reading({ forwards: { avgSpeedKmh: 45, relativeSpeed: 2, flow: 50 }, backwards: { avgSpeedKmh: 45, relativeSpeed: 2, flow: 50 } })],
      ['D2', reading({ forwards: { avgSpeedKmh: 45, relativeSpeed: 2, flow: 50 }, backwards: { avgSpeedKmh: 45, relativeSpeed: 2, flow: 50 } })],
    ])
    const baselines = new Map([
      ['D1|forwards', 90],
      ['D1|backwards', 90],
      ['D2|forwards', 90],
      ['D2|backwards', 90],
    ])

    const evidence = estimateSegments(evenSegments, readings, baselines, NOW)

    expect(evidence).not.toBeNull()
    expect(evidence!.minSeconds).toBe(evidence!.maxSeconds)
  })

  it('reports a real range when traffic is asymmetric between directions', () => {
    const readings = new Map([
      [
        'D1',
        reading({
          forwards: { avgSpeedKmh: 30, relativeSpeed: 2, flow: 50 }, // badly jammed one way
          backwards: { avgSpeedKmh: 88, relativeSpeed: 1, flow: 200 }, // fine the other way
        }),
      ],
      [
        'D2',
        reading({
          forwards: { avgSpeedKmh: 30, relativeSpeed: 2, flow: 50 },
          backwards: { avgSpeedKmh: 88, relativeSpeed: 1, flow: 200 },
        }),
      ],
    ])
    const baselines = new Map([
      ['D1|forwards', 90],
      ['D1|backwards', 90],
      ['D2|forwards', 90],
      ['D2|backwards', 90],
    ])

    const evidence = estimateSegments(evenSegments, readings, baselines, NOW)

    expect(evidence).not.toBeNull()
    expect(evidence!.maxSeconds).toBeGreaterThan(evidence!.minSeconds)
    // forwards direction is badly jammed (ratio clamped to MAX_SLOWDOWN_FACTOR),
    // backwards is near-baseline — the range should reflect that asymmetry,
    // not just "greater than" by a hair.
    expect(evidence!.minSeconds).toBeLessThan(50)
    expect(evidence!.maxSeconds).toBeGreaterThan(2000)
  })

  it('counts detectorCount as the union of detectors used across both directions', () => {
    const readings = new Map([
      ['D1', reading({ forwards: { avgSpeedKmh: 30, relativeSpeed: 2, flow: 50 } })],
      ['D2', reading({ backwards: { avgSpeedKmh: 30, relativeSpeed: 2, flow: 50 } })],
    ])
    const baselines = new Map([
      ['D1|forwards', 90],
      ['D2|backwards', 90],
    ])
    const segments: Segment[] = [
      { inMotionSec: 600, detectorId: 'D1' },
      { inMotionSec: 600, detectorId: 'D2' },
    ]

    const evidence = estimateSegments(segments, readings, baselines, NOW)

    expect(evidence).not.toBeNull()
    expect(evidence!.detectorCount).toBe(2)
  })
})
