import { planTrip } from '../plan-query'

// One transit leg, whose trip carries whatever wheelchair_accessible value
// the test is exercising. Everything else is the minimum planTrip needs to
// map an itinerary without reaching for anything optional.
function itinerary(wheelchairAccessible: string | null) {
  const place = { name: 'A', lat: 59.4, lon: 24.7, stop: { gtfsId: '1:s1' } }
  return {
    duration: 600,
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_600_000,
    walkDistance: 100,
    legs: [
      {
        mode: 'BUS',
        start: { scheduledTime: '2026-08-22T09:00:00Z' },
        end: { scheduledTime: '2026-08-22T09:10:00Z' },
        from: place,
        to: { ...place, name: 'B' },
        duration: 600,
        route: { gtfsId: '1:r1', shortName: '5' },
        trip: { gtfsId: '1:t1', wheelchairAccessible },
      },
    ],
  }
}

let sentBodies: string[] = []

function mockPlan(wheelchairAccessible: string | null) {
  sentBodies = []
  global.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
    sentBodies.push(init?.body ?? '')
    return {
      ok: true,
      json: async () => ({ data: { plan: { itineraries: [itinerary(wheelchairAccessible)] } } }),
    }
  }) as unknown as typeof fetch
}

async function accessibilityOf(value: string | null): Promise<boolean | undefined> {
  mockPlan(value)
  const result = await planTrip(59.4, 24.7, 59.5, 24.8, { modes: ['bus'] })
  return result.routes?.[0].legs[0].wheelchairAccessible
}

describe('wheelchair accessibility mapping', () => {
  it('reports a trip the operator marked accessible', async () => {
    expect(await accessibilityOf('POSSIBLE')).toBe(true)
  })

  it('reports a trip the operator marked not accessible', async () => {
    expect(await accessibilityOf('NOT_POSSIBLE')).toBe(false)
  })

  it('leaves an unstated accessibility undefined rather than calling it a no', async () => {
    // 61% of Estonian trips are NO_INFORMATION — rendering those as "not
    // accessible" would put words in the operator's mouth for most of the
    // country's services.
    expect(await accessibilityOf('NO_INFORMATION')).toBeUndefined()
    expect(await accessibilityOf(null)).toBeUndefined()
  })
})

describe('wheelchair request variable', () => {
  it('asks OTP for a step-free plan only when the option is set', async () => {
    mockPlan('POSSIBLE')
    await planTrip(59.4, 24.7, 59.5, 24.8, { modes: ['bus'], wheelchair: true })
    expect(JSON.parse(sentBodies[0]).variables.wheelchair).toBe(true)
  })

  it('omits the variable entirely on an ordinary plan', async () => {
    // Absent rather than false: OTP applies its own default, and this keeps
    // an ordinary search byte-identical to what it was before the option
    // existed.
    mockPlan('POSSIBLE')
    await planTrip(59.4, 24.7, 59.5, 24.8, { modes: ['bus'] })
    expect(JSON.parse(sentBodies[0]).variables).not.toHaveProperty('wheelchair')
  })
})
