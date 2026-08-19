import { getDb, __resetDbForTests } from '../../db'
import { recomputeBaselines, getBaselines, __resetBaselineCacheForTests, MIN_BASELINE_SAMPLES, MIN_BOOTSTRAP_SAMPLES } from '../baseline'

// recomputeBaselines() filters samples against a real Date.now()-based
// retention cutoff — a fixed historical timestamp here would fall outside
// that window and get silently excluded from every baseline.
const NOW = Date.now()

function insertSample(
  detectorId: string,
  direction: string,
  measuredAt: number,
  avgSpeed: number,
  flow: number | null,
  relativeSpeed: number | null,
): void {
  getDb()
    .prepare(
      'INSERT OR IGNORE INTO detector_sample (detector_id, direction, measured_at, avg_speed, flow, relative_speed) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(detectorId, direction, measuredAt, avgSpeed, flow, relativeSpeed)
}

beforeEach(() => {
  process.env.TRAFFIC_DB_PATH = ':memory:'
  __resetDbForTests()
  __resetBaselineCacheForTests()
})

describe('recomputeBaselines / getBaselines', () => {
  it('computes the 85th percentile of flow-qualified samples', () => {
    // 600 distinct speeds 1..600, one minute apart, well above
    // MIN_BASELINE_SAMPLES — 85th percentile of a uniform 1..600 series is
    // the value at index floor(0.85*600)=510, i.e. 511 (1-indexed values).
    for (let i = 0; i < 600; i++) {
      insertSample('D1', 'forwards', NOW - i * 60_000, i + 1, 20, 1)
    }

    recomputeBaselines()
    const baselines = getBaselines()

    expect(baselines.get('D1|forwards')).toBe(511)
  })

  it('excludes samples below the flow floor from the percentile baseline', () => {
    // 500 well-flowed samples all at 80 km/h...
    for (let i = 0; i < MIN_BASELINE_SAMPLES; i++) {
      insertSample('D2', 'forwards', NOW - i * 60_000, 80, 20, 1)
    }
    // ...plus a pile of near-empty-road low-flow samples at a much lower
    // speed that would drag the percentile down if they weren't excluded.
    for (let i = 0; i < 500; i++) {
      insertSample('D2', 'forwards', NOW - (MIN_BASELINE_SAMPLES + i) * 60_000, 10, 5, 2)
    }

    recomputeBaselines()
    const baselines = getBaselines()

    expect(baselines.get('D2|forwards')).toBe(80)
  })

  it('publishes no baseline for a detector below both MIN_BASELINE_SAMPLES and the bootstrap threshold', () => {
    // 100 flow-qualified samples: well short of MIN_BASELINE_SAMPLES, and
    // relative_speed 2 (not free-flow) so they don't feed the bootstrap either.
    for (let i = 0; i < 100; i++) {
      insertSample('D3', 'forwards', NOW - i * 60_000, 80, 20, 2)
    }
    // 10 free-flow-flagged samples: short of MIN_BOOTSTRAP_SAMPLES too.
    for (let i = 0; i < 10; i++) {
      insertSample('D3', 'backwards', NOW - i * 60_000, 80, 2, 1)
    }

    recomputeBaselines()
    const baselines = getBaselines()

    expect(baselines.has('D3|forwards')).toBe(false)
    expect(baselines.has('D3|backwards')).toBe(false)
  })

  it('uses the mean of relative_speed==1 samples as a cold-start bootstrap baseline', () => {
    // Below MIN_BASELINE_SAMPLES but at/above MIN_BOOTSTRAP_SAMPLES, all
    // flagged free-flow (relative_speed 1) by the feed itself, flow too low
    // to ever qualify for the percentile path.
    for (let i = 0; i < MIN_BOOTSTRAP_SAMPLES; i++) {
      insertSample('D4', 'forwards', NOW - i * 60_000, 90, 3, 1)
    }

    recomputeBaselines()
    const baselines = getBaselines()

    expect(baselines.get('D4|forwards')).toBe(90)
  })

  it('prefers the percentile baseline over the bootstrap once MIN_BASELINE_SAMPLES is reached', () => {
    for (let i = 0; i < MIN_BASELINE_SAMPLES; i++) {
      insertSample('D5', 'forwards', NOW - i * 60_000, 70, 20, i % 5 === 0 ? 1 : 2)
    }

    recomputeBaselines()
    const baselines = getBaselines()

    // All flow-qualified samples are at exactly 70 km/h, so the percentile
    // baseline is unambiguously 70 regardless of relative_speed.
    expect(baselines.get('D5|forwards')).toBe(70)
  })
})
