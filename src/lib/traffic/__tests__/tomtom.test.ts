import { parseFlowResponse, fetchFlowReadings, resetFlowState, isFlowConfigured, requestsRemaining } from '../tomtom'
import { CityProbe } from '../city-probes'
import { MAX_PROBE_REFRESH_PER_CYCLE, CITY_FLOW_CACHE_TTL } from '../../constants'

const NOW = 1_000_000_000

function body(overrides: Record<string, unknown> = {}) {
  return { flowSegmentData: { currentSpeed: 25, freeFlowSpeed: 50, confidence: 0.95, roadClosure: false, ...overrides } }
}

describe('parseFlowResponse', () => {
  it('reads current and free-flow speed off a well-formed response', () => {
    const reading = parseFlowResponse('P1', body(), NOW)
    expect(reading).toEqual({ probeId: 'P1', currentKmh: 25, freeFlowKmh: 50, confidence: 0.95, measuredAt: NOW })
  })

  it('rejects a response missing either speed rather than guessing one', () => {
    expect(parseFlowResponse('P1', body({ currentSpeed: undefined }), NOW)).toBeNull()
    expect(parseFlowResponse('P1', body({ freeFlowSpeed: undefined }), NOW)).toBeNull()
    expect(parseFlowResponse('P1', {}, NOW)).toBeNull()
    expect(parseFlowResponse('P1', null, NOW)).toBeNull()
  })

  it('rejects a closed road instead of turning it into an enormous delay', () => {
    // A closure means the bus is diverted or not running — it reaches riders
    // as a service alert, not as "~40 min slower" on a trip that isn't
    // happening.
    expect(parseFlowResponse('P1', body({ roadClosure: true }), NOW)).toBeNull()
  })

  it('rejects a reading TomTom itself has little confidence in', () => {
    expect(parseFlowResponse('P1', body({ confidence: 0.1 }), NOW)).toBeNull()
  })

  it('accepts a reading with no confidence field at all', () => {
    // Documented as optional. Defaulting the other way would silently switch
    // the whole feature off if TomTom stopped sending it.
    expect(parseFlowResponse('P1', body({ confidence: undefined }), NOW)?.currentKmh).toBe(25)
  })

  it('rejects non-positive speeds, which would divide by zero downstream', () => {
    expect(parseFlowResponse('P1', body({ currentSpeed: 0 }), NOW)).toBeNull()
    expect(parseFlowResponse('P1', body({ freeFlowSpeed: 0 }), NOW)).toBeNull()
  })
})

function probes(count: number): CityProbe[] {
  return Array.from({ length: count }, (_, i) => ({ id: `P${i}`, lat: 58.38 + i / 1000, lon: 26.72, routeCount: 3 }))
}

describe('fetchFlowReadings', () => {
  const originalKey = process.env.TOMTOM_API_KEY
  let fetchMock: jest.Mock

  beforeEach(() => {
    resetFlowState()
    fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => body() })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.TOMTOM_API_KEY
    else process.env.TOMTOM_API_KEY = originalKey
  })

  it('makes no requests at all when no API key is configured', async () => {
    delete process.env.TOMTOM_API_KEY
    expect(isFlowConfigured()).toBe(false)

    const readings = await fetchFlowReadings(probes(5))

    expect(readings.size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches each probe once and serves the rest of the TTL from cache', async () => {
    process.env.TOMTOM_API_KEY = 'test-key'

    const first = await fetchFlowReadings(probes(3))
    const second = await fetchFlowReadings(probes(3))

    expect(first.size).toBe(3)
    expect(second.size).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('refetches a probe once its reading has aged past the cache TTL', async () => {
    process.env.TOMTOM_API_KEY = 'test-key'
    await fetchFlowReadings(probes(1))

    const later = Date.now() + CITY_FLOW_CACHE_TTL + 1_000
    jest.spyOn(Date, 'now').mockReturnValue(later)
    await fetchFlowReadings(probes(1))
    jest.spyOn(Date, 'now').mockRestore()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caps how many probes one cycle may refresh, so a wide selection cannot burst the budget', async () => {
    process.env.TOMTOM_API_KEY = 'test-key'

    await fetchFlowReadings(probes(MAX_PROBE_REFRESH_PER_CYCLE + 25))

    expect(fetchMock).toHaveBeenCalledTimes(MAX_PROBE_REFRESH_PER_CYCLE)
  })

  it('spends the cycle on the probes it was given first', async () => {
    // The caller orders probes by the rider's own city selection, so a
    // truncated cycle has to serve the cities actually being looked at.
    process.env.TOMTOM_API_KEY = 'test-key'
    const all = probes(MAX_PROBE_REFRESH_PER_CYCLE + 10)

    const readings = await fetchFlowReadings(all)

    expect(readings.has(all[0].id)).toBe(true)
    expect(readings.has(all[all.length - 1].id)).toBe(false)
  })

  it('keeps a probe’s previous reading when a refresh fails', async () => {
    process.env.TOMTOM_API_KEY = 'test-key'
    await fetchFlowReadings(probes(1))
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })

    const later = Date.now() + CITY_FLOW_CACHE_TTL + 1_000
    jest.spyOn(Date, 'now').mockReturnValue(later)
    const readings = await fetchFlowReadings(probes(1))
    jest.spyOn(Date, 'now').mockRestore()

    // Still present — estimate time drops it on age (MAX_READING_AGE_MS)
    // rather than this layer erasing a reading that may still be usable.
    expect(readings.get('P0')?.currentKmh).toBe(25)
  })

  it('stops spending once the day’s request budget is exhausted', async () => {
    jest.resetModules()
    process.env.TOMTOM_API_KEY = 'test-key'
    process.env.TOMTOM_DAILY_REQUEST_BUDGET = '5'
    const tomtom = await import('../tomtom')
    tomtom.resetFlowState()

    await tomtom.fetchFlowReadings(probes(20))

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(tomtom.requestsRemaining()).toBe(0)
    delete process.env.TOMTOM_DAILY_REQUEST_BUDGET
  })

  it('reports a full allowance before anything has been spent', () => {
    resetFlowState()
    expect(requestsRemaining()).toBeGreaterThan(0)
  })
})
