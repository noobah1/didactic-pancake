import { parseSrtiResponse, isDatexConfigured, getDatexHazardAlerts, resetDatexCache, FEEDS } from '../datex-srti'

function feed(path: string) {
  const found = FEEDS.find((f) => f.path === path)
  if (!found) throw new Error(`no feed configured for ${path}`)
  return found
}

// Real shapes from Transpordiamet's own example payloads
// (tarktee.transpordiamet.ee/assets/datex/datex3_ee_srti_*_example.json),
// confirmed live against the real feeds too (200 OK, matching field names).
function situationRecord(overrides: Record<string, unknown>) {
  return {
    situation: [
      {
        id: 'S1',
        situationRecord: [
          {
            id: 'R1',
            probabilityOfOccurrence: { value: 'CERTAIN' },
            locationReference: { pointByCoordinates: { pointCoordinates: { latitude: 59.437, longitude: 24.7536 } } },
            ...overrides,
          },
        ],
      },
    ],
  }
}

describe('parseSrtiResponse', () => {
  it('reads a slippery-road record (array-shaped enum field)', () => {
    const body = situationRecord({ weatherRelatedRoadConditionType: [{ value: 'SLIPPERY' }] })
    expect(parseSrtiResponse(feed('temporarySlipperyRoad'), body)).toEqual([
      { id: 'R1', lat: 59.437, lng: 24.7536, headerText: 'Libe tee', severity: 'warning' },
    ])
  })

  it('reads an animal-obstacle record (object-shaped enum field)', () => {
    const body = situationRecord({ animalPresenceType: { value: 'ANIMALS_ON_THE_ROAD' } })
    expect(parseSrtiResponse(feed('animalObstacle'), body)[0].headerText).toBe('Loomad teel')
  })

  it('falls back through animalObstacle’s three possible sub-fields in order', () => {
    const fallenTree = situationRecord({ environmentalObstructionType: [{ value: 'FALLEN_TREES' }] })
    expect(parseSrtiResponse(feed('animalObstacle'), fallenTree)[0].headerText).toBe('Puu langenud teele')

    const object = situationRecord({ generalObstructionType: [{ value: 'OBJECT_ON_THE_ROAD' }] })
    expect(parseSrtiResponse(feed('animalObstacle'), object)[0].headerText).toBe('Ese teel')
  })

  it('marks an unprotected accident area and a blocked road as severe', () => {
    const accident = situationRecord({ obstructionType: [{ value: 'UNPROTECTED_ACCIDENT_AREA' }] })
    expect(parseSrtiResponse(feed('unprotectedAccident'), accident)[0].severity).toBe('severe')

    const blockage = situationRecord({ trafficConstrictionType: { value: 'ROAD_BLOCKED' } })
    expect(parseSrtiResponse(feed('unmanagedBlockage'), blockage)[0].severity).toBe('severe')
  })

  it('labels each exceptional-weather sub-type distinctly', () => {
    const snow = situationRecord({ poorEnvironmentType: [{ value: 'HEAVY_SNOWFALL' }] })
    expect(parseSrtiResponse(feed('exceptionalWeather'), snow)[0].headerText).toBe('Tugev lumesadu')

    const wind = situationRecord({ poorEnvironmentType: [{ value: 'STRONG_WINDS' }] })
    expect(parseSrtiResponse(feed('exceptionalWeather'), wind)[0].headerText).toBe('Tugev tuul')
  })

  it('drops a record whose sub-type value is not one the feed documents, rather than guessing a label', () => {
    const body = situationRecord({ poorEnvironmentType: [{ value: 'SOMETHING_NEW_TARK_TEE_ADDED' }] })
    expect(parseSrtiResponse(feed('exceptionalWeather'), body)).toEqual([])
  })

  it('drops RISK_OF as too speculative to surface as a current hazard', () => {
    const body = situationRecord({
      probabilityOfOccurrence: { value: 'RISK_OF' },
      weatherRelatedRoadConditionType: [{ value: 'SLIPPERY' }],
    })
    expect(parseSrtiResponse(feed('temporarySlipperyRoad'), body)).toEqual([])
  })

  it('keeps PROBABLE alongside CERTAIN', () => {
    const body = situationRecord({
      probabilityOfOccurrence: { value: 'PROBABLE' },
      weatherRelatedRoadConditionType: [{ value: 'SLIPPERY' }],
    })
    expect(parseSrtiResponse(feed('temporarySlipperyRoad'), body)).toHaveLength(1)
  })

  it('drops a record with no point location rather than guessing one', () => {
    const body = {
      situation: [
        {
          situationRecord: [
            {
              id: 'R1',
              probabilityOfOccurrence: { value: 'CERTAIN' },
              locationReference: null,
              weatherRelatedRoadConditionType: [{ value: 'SLIPPERY' }],
            },
          ],
        },
      ],
    }
    expect(parseSrtiResponse(feed('temporarySlipperyRoad'), body)).toEqual([])
  })

  it('returns nothing for a malformed or empty response instead of throwing', () => {
    expect(parseSrtiResponse(feed('temporarySlipperyRoad'), null)).toEqual([])
    expect(parseSrtiResponse(feed('temporarySlipperyRoad'), {})).toEqual([])
    expect(parseSrtiResponse(feed('temporarySlipperyRoad'), { situation: [] })).toEqual([])
  })
})

describe('isDatexConfigured / getDatexHazardAlerts', () => {
  const originalKey = process.env.DATEX_API_KEY

  afterEach(() => {
    if (originalKey === undefined) delete process.env.DATEX_API_KEY
    else process.env.DATEX_API_KEY = originalKey
    resetDatexCache()
  })

  it('is off with no key configured, and fetches nothing', async () => {
    delete process.env.DATEX_API_KEY
    expect(isDatexConfigured()).toBe(false)

    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    expect(await getDatexHazardAlerts()).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
