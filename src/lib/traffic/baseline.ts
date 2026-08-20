import { getDb } from '../db'
import { DetectorReading } from './detectors'

// How long a detector sample stays useful for computing a baseline. Longer
// than this and a stretch of road that was genuinely rebuilt/re-posted
// stops being represented by traffic that no longer applies to it; shorter
// and a baseline never sees enough of the week's normal variation (weekday
// rush vs. weekend, term-time vs. summer) to be a fair "usual speed."
const BASELINE_RETENTION_DAYS = 28
// A percentile, not a max — the single fastest reading in 28 days is likely
// a near-empty road at 3am, not a speed real "free flow" traffic sustains.
// 85th keeps the estimate from calling ordinary light-traffic variance a
// slowdown, without needing the road all to itself to count as free-flowing.
const FREE_FLOW_PERCENTILE = 0.85
// A lone car at 3am doesn't establish a road's baseline speed the way a
// dozen cars in normal traffic does — this is the flow floor a sample needs
// to count toward the percentile baseline (not the bootstrap path below,
// which uses the feed's own free-flow signal instead).
const MIN_FLOW_FOR_BASELINE = 10
// Below this many flow-qualified samples, the percentile isn't trustworthy
// yet — a detector this fresh instead uses the bootstrap path.
export const MIN_BASELINE_SAMPLES = 500
// Cold-start path: while a detector is below MIN_BASELINE_SAMPLES, take the
// mean of samples the feed's own relative_speed already flags as free-flow
// (level 1) — gets a usable, if cruder, baseline within hours of first
// deploy instead of the ~28 days a full percentile needs to accumulate.
export const MIN_BOOTSTRAP_SAMPLES = 40

interface SampleRow {
  detector_id: string
  direction: string
  avg_speed: number
  flow: number | null
  relative_speed: number | null
}

interface BaselineRow {
  detector_id: string
  direction: string
  free_flow_kmh: number
}

// Persist this poll's readings. INSERT OR IGNORE on the (detector, direction,
// measured_at) primary key makes this idempotent — re-recording the same
// 5-minute reading (e.g. after a process restart) is a harmless no-op rather
// than a duplicate row skewing the baseline.
// Failures (especially disk I/O on cloud storage) are non-critical — the
// app's core routes/delays features don't depend on traffic estimates, so
// we silently swallow errors rather than letting a locked database
// block the traffic sampler's whole tick.
export function recordSamples(readings: Map<string, DetectorReading>): void {
  try {
    const db = getDb()
    const insert = db.prepare(
      'INSERT OR IGNORE INTO detector_sample (detector_id, direction, measured_at, avg_speed, flow, relative_speed) VALUES (?, ?, ?, ?, ?, ?)',
    )
    for (const r of readings.values()) {
      if (r.forwards) {
        insert.run(r.detectorId, 'forwards', r.measuredAt, r.forwards.avgSpeedKmh, r.forwards.flow, r.forwards.relativeSpeed)
      }
      if (r.backwards) {
        insert.run(r.detectorId, 'backwards', r.measuredAt, r.backwards.avgSpeedKmh, r.backwards.flow, r.backwards.relativeSpeed)
      }
    }
    const cutoff = Date.now() - BASELINE_RETENTION_DAYS * 86_400_000
    db.prepare('DELETE FROM detector_sample WHERE measured_at < ?').run(cutoff)
  } catch {
    // Non-critical: database write failure just means this poll's samples
    // weren't recorded. The next poll will try again.
  }
}

function percentile(sortedAsc: number[], p: number): number {
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))
  return sortedAsc[idx]
}

// Recompute every detector/direction's free-flow baseline from retained
// history. Cheap enough to run once a day (see traffic/sampler.ts) — a
// single pass over at most 28 days × 116 detectors × 2 directions × ~288
// samples/day, all in memory.
export function recomputeBaselines(): void {
  try {
    const db = getDb()
    const cutoff = Date.now() - BASELINE_RETENTION_DAYS * 86_400_000
    const rows = db
      .prepare('SELECT detector_id, direction, avg_speed, flow, relative_speed FROM detector_sample WHERE measured_at >= ?')
      .all(cutoff) as unknown as SampleRow[]

    const byKey = new Map<string, { flowFiltered: number[]; freeFlowOnly: number[] }>()
    for (const row of rows) {
      const key = `${row.detector_id}|${row.direction}`
      let bucket = byKey.get(key)
      if (!bucket) {
        bucket = { flowFiltered: [], freeFlowOnly: [] }
        byKey.set(key, bucket)
      }
      if (row.flow != null && row.flow >= MIN_FLOW_FOR_BASELINE) bucket.flowFiltered.push(row.avg_speed)
      if (row.relative_speed === 1) bucket.freeFlowOnly.push(row.avg_speed)
    }

    const now = Date.now()
    const upsert = db.prepare(`
      INSERT INTO detector_baseline (detector_id, direction, free_flow_kmh, sample_count, computed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(detector_id, direction) DO UPDATE SET
        free_flow_kmh = excluded.free_flow_kmh,
        sample_count = excluded.sample_count,
        computed_at = excluded.computed_at
    `)

    for (const [key, bucket] of byKey) {
      const [detectorId, direction] = key.split('|')
      if (bucket.flowFiltered.length >= MIN_BASELINE_SAMPLES) {
        const sorted = [...bucket.flowFiltered].sort((a, b) => a - b)
        upsert.run(detectorId, direction, percentile(sorted, FREE_FLOW_PERCENTILE), bucket.flowFiltered.length, now)
      } else if (bucket.freeFlowOnly.length >= MIN_BOOTSTRAP_SAMPLES) {
        const mean = bucket.freeFlowOnly.reduce((s, v) => s + v, 0) / bucket.freeFlowOnly.length
        upsert.run(detectorId, direction, mean, bucket.freeFlowOnly.length, now)
      }
    }
  } catch {
    // Non-critical: baseline recomputation failure just skips this cycle.
  }
}

let baselineCache: { data: Map<string, number>; timestamp: number } | null = null
// In-memory read-through over the persisted table — recomputeBaselines()
// only runs once a day, so there's no reason for every /api/delays cycle to
// re-query SQLite; this just needs to notice that daily update eventually.
const BASELINE_READ_CACHE_TTL = 6 * 60 * 60_000

// Map keyed "detectorId|direction" -> free-flow km/h, for estimate.ts's
// excess-time ratio.
export function getBaselines(): Map<string, number> {
  const now = Date.now()
  if (baselineCache && now - baselineCache.timestamp < BASELINE_READ_CACHE_TTL) {
    return baselineCache.data
  }
  try {
    const db = getDb()
    const rows = db.prepare('SELECT detector_id, direction, free_flow_kmh FROM detector_baseline').all() as unknown as BaselineRow[]
    const map = new Map<string, number>()
    for (const row of rows) map.set(`${row.detector_id}|${row.direction}`, row.free_flow_kmh)
    baselineCache = { data: map, timestamp: now }
    return map
  } catch {
    // Non-critical: return last known cache or empty if none
    return baselineCache?.data || new Map()
  }
}

// Test-only: force the next getBaselines() to re-read the database instead
// of serving the in-memory cache.
export function __resetBaselineCacheForTests(): void {
  baselineCache = null
}
