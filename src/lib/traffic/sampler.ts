import { fetchDetectorReadings } from './detectors'
import { recordSamples, recomputeBaselines } from './baseline'

// Detector readings refresh ~every 5 min on Tark Tee's side (see
// DETECTOR_CACHE_TTL) — sampling faster wouldn't see new data, only add
// duplicate (harmlessly ignored, see recordSamples) rows.
const SAMPLE_INTERVAL_MS = 5 * 60_000
// Baselines are learned from up to 28 days of history (see
// BASELINE_RETENTION_DAYS in baseline.ts) — recomputing more than once a day
// wouldn't meaningfully change them, just cost an extra full-history scan.
const BASELINE_RECOMPUTE_INTERVAL_MS = 24 * 60 * 60_000

let started = false
// Re-entrancy guard for the setInterval below — without it, a slow upstream
// fetch could still be running when the next tick fires.
let sampling = false
let lastBaselineRecompute = 0

// Called once from instrumentation.ts on server boot, next to
// startPushChecker(). Guarded so importing this module twice (e.g. dev
// hot-reload) can't start a second interval.
export function startDetectorSampler(): void {
  if (started) return
  started = true
  console.log('[traffic-sampler] started, sampling every', SAMPLE_INTERVAL_MS, 'ms')

  const tick = async () => {
    if (sampling) return
    sampling = true
    try {
      const readings = await fetchDetectorReadings()
      if (readings.size > 0) recordSamples(readings)

      const now = Date.now()
      if (now - lastBaselineRecompute >= BASELINE_RECOMPUTE_INTERVAL_MS) {
        recomputeBaselines()
        lastBaselineRecompute = now
      }
    } catch (error) {
      console.error('[traffic-sampler] tick failed:', error)
    } finally {
      sampling = false
    }
  }

  // Run once immediately rather than waiting a full SAMPLE_INTERVAL_MS for
  // the first sample — on a fresh deploy, every minute not spent
  // accumulating samples is a minute added to the cold-start window before
  // any estimate can be shown at all (see baseline.ts's bootstrap path).
  void tick()
  setInterval(tick, SAMPLE_INTERVAL_MS)
}
