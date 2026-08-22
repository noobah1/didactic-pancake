import {
  TOMTOM_FLOW_URL,
  TOMTOM_FLOW_ZOOM,
  TOMTOM_FLOW_TIMEOUT_MS,
  TOMTOM_MIN_CONFIDENCE,
  CITY_FLOW_CACHE_TTL,
  TOMTOM_DAILY_REQUEST_BUDGET,
  MAX_PROBE_REFRESH_PER_CYCLE,
} from '../constants'
import { CityProbe } from './city-probes'

// Live current-vs-free-flow road speed at a city probe point, from TomTom's
// Traffic Flow Segment Data API. This is the city-street equivalent of
// ./detectors.ts's Tark Tee readings, and is shaped to be used the same way:
// a current speed, and the "usual" speed to compare it against.
//
// One difference matters downstream. A Tark Tee detector reports each
// direction of its road separately; TomTom returns one reading for whichever
// direction of the segment it matched, so there is no forwards/backwards
// split to disambiguate — see city-estimate.ts for what that means for the
// reported range.
//
// freeFlowKmh is carried on the reading but is deliberately NOT what a
// slowdown is measured against: free-flow is the road unimpeded, not the
// road as it usually is, and city traffic runs below free-flow all day with
// nothing wrong. city-estimate.ts compares against the timetable's own
// implied speed instead. It's kept because a response carrying only half its
// speed fields is one we don't understand well enough to trust, so
// parseFlowResponse requires both.
//
// IMPORTANT: unlike every other upstream in this codebase, none of this has
// been confirmed against the live service — it was written without an API
// key. Field names follow TomTom's published v4 flowSegmentData response
// (flowSegmentData.currentSpeed / freeFlowSpeed / confidence / roadClosure).
// Every field is treated as possibly-absent for that reason, and the whole
// feature is off unless TOMTOM_API_KEY is set.
export interface FlowReading {
  probeId: string
  currentKmh: number
  freeFlowKmh: number
  // TomTom's own 0-1 confidence in the reading. Kept on the reading so the
  // threshold that gates it stays inspectable from tests.
  confidence: number
  measuredAt: number // ms epoch — when we fetched it; the API reports no measurement time
}

interface RawFlowResponse {
  flowSegmentData?: {
    currentSpeed?: number
    freeFlowSpeed?: number
    confidence?: number
    roadClosure?: boolean
  }
}

let cache = new Map<string, FlowReading>()

// Requests spent today, per UTC day. In-process only: a restart resets it and
// a second instance gets its own allowance, which is why
// TOMTOM_DAILY_REQUEST_BUDGET is set below the plan's actual limit rather
// than at it.
let spend = { day: '', count: 0 }

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function requestsRemaining(): number {
  if (spend.day !== today()) return TOMTOM_DAILY_REQUEST_BUDGET
  return Math.max(0, TOMTOM_DAILY_REQUEST_BUDGET - spend.count)
}

function spendRequest(): boolean {
  const day = today()
  if (spend.day !== day) spend = { day, count: 0 }
  if (spend.count >= TOMTOM_DAILY_REQUEST_BUDGET) return false
  spend.count++
  return true
}

// Exported for tests — resets both the reading cache and the day's spend.
export function resetFlowState(): void {
  cache = new Map()
  spend = { day: '', count: 0 }
}

export function isFlowConfigured(): boolean {
  return Boolean(process.env.TOMTOM_API_KEY)
}

// Parse one flowSegmentData response into a reading, or null if it can't be
// trusted. Separated from the fetch so the parsing rules — which are the part
// most likely to need correcting against a real response — are testable
// without a network or a key.
export function parseFlowResponse(probeId: string, body: unknown, now: number): FlowReading | null {
  const data = (body as RawFlowResponse)?.flowSegmentData
  if (!data) return null
  const { currentSpeed, freeFlowSpeed, confidence, roadClosure } = data
  if (typeof currentSpeed !== 'number' || typeof freeFlowSpeed !== 'number') return null
  if (currentSpeed <= 0 || freeFlowSpeed <= 0) return null
  // A closed road isn't a slowdown to add minutes for — the bus is either
  // diverted or not running, and a closure already reaches riders as a
  // service alert (see tarktee.ts). Turning it into "~40 min slower" would
  // be a confident number for a trip that isn't happening.
  if (roadClosure) return null
  // Absent confidence is treated as trustworthy rather than dropped: it's a
  // documented-optional field, and defaulting the other way would silently
  // disable the whole feature if TomTom stops sending it.
  if (typeof confidence === 'number' && confidence < TOMTOM_MIN_CONFIDENCE) return null
  return { probeId, currentKmh: currentSpeed, freeFlowKmh: freeFlowSpeed, confidence: confidence ?? 1, measuredAt: now }
}

async function fetchOne(probe: CityProbe, key: string): Promise<FlowReading | null> {
  const url =
    `${TOMTOM_FLOW_URL}/absolute/${TOMTOM_FLOW_ZOOM}/json` +
    `?point=${probe.lat},${probe.lon}&unit=KMPH&openLr=false&key=${encodeURIComponent(key)}`
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TOMTOM_FLOW_TIMEOUT_MS) })
    if (!response.ok) return null
    return parseFlowResponse(probe.id, await response.json(), Date.now())
  } catch {
    return null
  }
}

// Requests are issued a few at a time rather than all at once — 40 parallel
// sockets to one host is the kind of burst that gets an API key rate-limited
// for the rest of the minute, and nothing here is latency-critical enough to
// need them.
const CONCURRENCY = 6

// Current readings for the given probes, freshest-first from cache.
//
// `probes` is expected in priority order — the cities the rider is actually
// looking at first (see computeCityTrafficEstimates). Only probes whose
// cached reading has aged past CITY_FLOW_CACHE_TTL are refetched, at most
// MAX_PROBE_REFRESH_PER_CYCLE per call and only while the day's budget
// holds; everything else is served from cache. A probe that can't be
// refreshed keeps its old reading, which estimate-time then drops on age
// (MAX_READING_AGE_MS) rather than treating as current.
export async function fetchFlowReadings(probes: CityProbe[]): Promise<Map<string, FlowReading>> {
  const key = process.env.TOMTOM_API_KEY
  if (!key) return new Map()

  const now = Date.now()
  const stale = probes.filter((p) => {
    const cached = cache.get(p.id)
    return !cached || now - cached.measuredAt >= CITY_FLOW_CACHE_TTL
  })
  const budget = Math.min(stale.length, MAX_PROBE_REFRESH_PER_CYCLE, requestsRemaining())
  const queue = stale.slice(0, budget)

  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (next < queue.length) {
        const probe = queue[next++]
        if (!spendRequest()) return
        const reading = await fetchOne(probe, key)
        // A failed probe is left with whatever it had: one bad response
        // shouldn't erase a reading that's still inside its age window, and
        // if it isn't, the age check downstream drops it anyway.
        if (reading) cache.set(probe.id, reading)
      }
    }),
  )

  const out = new Map<string, FlowReading>()
  for (const probe of probes) {
    const reading = cache.get(probe.id)
    if (reading) out.set(probe.id, reading)
  }
  return out
}
