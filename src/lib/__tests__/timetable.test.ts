import { trimStops } from '../timetable'
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
