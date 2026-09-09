import { resolveTime, mapPlace, GqlTime, GqlPlace } from '../plan-mapping'

describe('resolveTime', () => {
  it('prefers estimated.time over scheduledTime when a realtime estimate exists', () => {
    const t: GqlTime = {
      scheduledTime: '2026-09-09T08:00:00.000Z',
      estimated: { time: '2026-09-09T08:03:00.000Z' },
    }
    expect(resolveTime(t)).toBe('2026-09-09T08:03:00.000Z')
  })

  it('falls back to scheduledTime when there is no estimate', () => {
    const t: GqlTime = { scheduledTime: '2026-09-09T08:00:00.000Z', estimated: null }
    expect(resolveTime(t)).toBe('2026-09-09T08:00:00.000Z')
  })

  it('falls back to scheduledTime when estimated exists but has no time', () => {
    const t = { scheduledTime: '2026-09-09T08:00:00.000Z', estimated: { time: '' } } as GqlTime
    expect(resolveTime(t)).toBe('2026-09-09T08:00:00.000Z')
  })
})

describe('mapPlace', () => {
  it('maps lon to lng and prefers estimated departure/arrival times', () => {
    const place: GqlPlace = {
      name: 'Viru keskus',
      lat: 59.4372,
      lon: 24.7574,
      stop: { gtfsId: '1:1234' },
      departure: { scheduledTime: '2026-09-09T08:00:00.000Z', estimated: { time: '2026-09-09T08:02:00.000Z' } },
      arrival: { scheduledTime: '2026-09-09T08:10:00.000Z', estimated: null },
    }

    expect(mapPlace(place)).toEqual({
      name: 'Viru keskus',
      lat: 59.4372,
      lng: 24.7574,
      stopId: '1:1234',
      departure: '2026-09-09T08:02:00.000Z',
      arrival: '2026-09-09T08:10:00.000Z',
    })
  })

  it('leaves departure/arrival undefined and name empty when absent', () => {
    const place: GqlPlace = { lat: 59.4, lon: 24.7 }
    expect(mapPlace(place)).toEqual({
      name: '',
      lat: 59.4,
      lng: 24.7,
      stopId: undefined,
      departure: undefined,
      arrival: undefined,
    })
  })
})
