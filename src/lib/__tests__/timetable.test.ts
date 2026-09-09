import { trimStops, computeArrivalInfo } from '../timetable'
import { TripStopInfo } from '../types'

function stop(overrides: Partial<TripStopInfo>): TripStopInfo {
  return {
    name: 'Stop',
    lat: 59.4,
    lng: 24.7,
    stopId: '1',
    scheduledArrival: 0,
    scheduledDeparture: 0,
    status: 'upcoming',
    ...overrides,
  }
}

describe('trimStops', () => {
  it('keeps one stop of buffer before the most recently passed stop', () => {
    const stops = [
      stop({ stopId: 'a', status: 'passed' }),
      stop({ stopId: 'b', status: 'passed' }),
      stop({ stopId: 'c', status: 'current' }),
      stop({ stopId: 'd', status: 'upcoming' }),
    ]
    // lastPassedIdx = 1 ('b'); from = max(0, 1 - 1) = 0 -> keeps everything
    expect(trimStops(stops).map((s) => s.stopId)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('drops stops passed more than one stop ago', () => {
    const stops = [
      stop({ stopId: 'a', status: 'passed' }),
      stop({ stopId: 'b', status: 'passed' }),
      stop({ stopId: 'c', status: 'passed' }),
      stop({ stopId: 'd', status: 'current' }),
      stop({ stopId: 'e', status: 'upcoming' }),
    ]
    // lastPassedIdx = 2 ('c'); from = max(0, 2 - 1) = 1 -> drops 'a'
    expect(trimStops(stops).map((s) => s.stopId)).toEqual(['b', 'c', 'd', 'e'])
  })

  it('returns everything from the start when no stop has been passed yet', () => {
    const stops = [
      stop({ stopId: 'a', status: 'upcoming' }),
      stop({ stopId: 'b', status: 'upcoming' }),
    ]
    expect(trimStops(stops).map((s) => s.stopId)).toEqual(['a', 'b'])
  })

  it('does not go negative when the passed stop is first', () => {
    const stops = [
      stop({ stopId: 'a', status: 'passed' }),
      stop({ stopId: 'b', status: 'upcoming' }),
    ]
    expect(trimStops(stops).map((s) => s.stopId)).toEqual(['a', 'b'])
  })

  it('handles an empty list', () => {
    expect(trimStops([])).toEqual([])
  })
})

describe('computeArrivalInfo', () => {
  it('treats exactly on schedule as on time', () => {
    expect(computeArrivalInfo(1000, 1000)).toEqual({ minutes: 0, late: false })
  })

  it('treats up to 59s past schedule as on time (buffer)', () => {
    expect(computeArrivalInfo(1000, 1059)).toEqual({ minutes: 0, late: false })
  })

  it('treats 60s past schedule as late', () => {
    expect(computeArrivalInfo(1000, 1060)).toEqual({ minutes: 1, late: true })
  })

  it('rounds up minutes late for a longer delay', () => {
    // 125s past schedule -> ceil(125/60) = 3 minutes late
    expect(computeArrivalInfo(1000, 1125)).toEqual({ minutes: 3, late: true })
  })

  it('rounds up minutes remaining for a future arrival', () => {
    // 125s in the future -> ceil(125/60) = 3 minutes
    expect(computeArrivalInfo(1125, 1000)).toEqual({ minutes: 3, late: false })
  })
})
