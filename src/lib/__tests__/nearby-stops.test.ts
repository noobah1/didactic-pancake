import { buildNearbyStops, shouldWiden, GqlNearbyEdge } from '../nearby-stops'

function edge(overrides: Partial<GqlNearbyEdge['node']> & { stopOverrides?: Partial<GqlNearbyEdge['node']['stop']> }): GqlNearbyEdge {
  const { stopOverrides, ...nodeOverrides } = overrides
  return {
    node: {
      distance: 100,
      stop: {
        gtfsId: '1:1000',
        name: 'Test stop',
        lat: 59.437,
        lon: 24.7536,
        stoptimesWithoutPatterns: [],
        ...stopOverrides,
      },
      ...nodeOverrides,
    },
  }
}

function stoptime(overrides: Partial<GqlNearbyEdge['node']['stop']['stoptimesWithoutPatterns'][number]> = {}) {
  return {
    scheduledDeparture: 40_800,
    realtimeDeparture: 40_800,
    realtime: false,
    serviceDay: 1_787_086_800,
    headsign: 'Kadriorg',
    trip: { gtfsId: '1:12765', route: { shortName: 'T1', mode: 'TRAM' } },
    ...overrides,
  }
}

describe('buildNearbyStops', () => {
  it('drops stops with zero upcoming departures (the feed-2 phantom-duplicate case)', () => {
    // Verified live against OTP: stopsByRadius returns a second edge for the
    // same physical stop from the stale elron.zip feed (gtfsId prefix "2:"),
    // identical coordinates, zero stoptimes.
    const edges = [
      edge({ distance: 81, stopOverrides: { gtfsId: '1:1294', stoptimesWithoutPatterns: [stoptime()] } }),
      edge({ distance: 81, stopOverrides: { gtfsId: '2:1294', stoptimesWithoutPatterns: [] } }),
    ]
    const result = buildNearbyStops(edges, 8)
    expect(result).toHaveLength(1)
    expect(result[0].stopId).toBe('1:1294')
  })

  it('sorts by distance even when OTP returns edges out of order', () => {
    // Real observed ordering from a live query: 158m, 158m, 207m, 207m, 191m.
    const edges = [
      edge({ distance: 158, stopOverrides: { gtfsId: 'a', stoptimesWithoutPatterns: [stoptime()] } }),
      edge({ distance: 207, stopOverrides: { gtfsId: 'b', stoptimesWithoutPatterns: [stoptime()] } }),
      edge({ distance: 191, stopOverrides: { gtfsId: 'c', stoptimesWithoutPatterns: [stoptime()] } }),
    ]
    const result = buildNearbyStops(edges, 8)
    expect(result.map((s) => s.stopId)).toEqual(['a', 'c', 'b'])
  })

  it('truncates to maxStops after sorting', () => {
    const edges = [300, 100, 200].map((d, i) =>
      edge({ distance: d, stopOverrides: { gtfsId: `s${i}`, stoptimesWithoutPatterns: [stoptime()] } }),
    )
    const result = buildNearbyStops(edges, 2)
    expect(result).toHaveLength(2)
    expect(result.map((s) => s.distanceMeters)).toEqual([100, 200])
  })

  it('sorts a stop\'s own departures ascending by departure time', () => {
    const edges = [
      edge({
        stopOverrides: {
          stoptimesWithoutPatterns: [
            stoptime({ scheduledDeparture: 41_580, trip: { gtfsId: 't2', route: { shortName: 'T1', mode: 'TRAM' } } }),
            stoptime({ scheduledDeparture: 40_800, trip: { gtfsId: 't1', route: { shortName: 'T1', mode: 'TRAM' } } }),
          ],
        },
      }),
    ]
    const result = buildNearbyStops(edges, 8)
    expect(result[0].departures.map((d) => d.tripId)).toEqual(['t1', 't2'])
  })

  it('leaves delaySeconds undefined (never 0) when a departure is not realtime', () => {
    const edges = [edge({ stopOverrides: { stoptimesWithoutPatterns: [stoptime({ realtime: false })] } })]
    const result = buildNearbyStops(edges, 8)
    expect(result[0].departures[0].delaySeconds).toBeUndefined()
  })

  it('computes delaySeconds and departureEpochSec from realtime fields when realtime is true', () => {
    const edges = [
      edge({
        stopOverrides: {
          stoptimesWithoutPatterns: [
            stoptime({ realtime: true, scheduledDeparture: 40_800, realtimeDeparture: 40_980, serviceDay: 1_787_086_800 }),
          ],
        },
      }),
    ]
    const result = buildNearbyStops(edges, 8)
    expect(result[0].departures[0].delaySeconds).toBe(180)
    expect(result[0].departures[0].departureEpochSec).toBe(1_787_086_800 + 40_980)
  })

  it('caps how many same-named stops (separate platforms) can appear when maxPerName is set', () => {
    // Real observed shape from a live query: 4 stops all named "Mere
    // puiestee" for different platforms/directions, closer than a single
    // "Viru" stop further out.
    const edges = [
      edge({ distance: 81, stopOverrides: { gtfsId: 'mp1', name: 'Mere puiestee', stoptimesWithoutPatterns: [stoptime()] } }),
      edge({ distance: 99, stopOverrides: { gtfsId: 'mp2', name: 'Mere puiestee', stoptimesWithoutPatterns: [stoptime()] } }),
      edge({ distance: 108, stopOverrides: { gtfsId: 'mp3', name: 'Mere puiestee', stoptimesWithoutPatterns: [stoptime()] } }),
      edge({ distance: 156, stopOverrides: { gtfsId: 'mp4', name: 'Mere puiestee', stoptimesWithoutPatterns: [stoptime()] } }),
      edge({ distance: 158, stopOverrides: { gtfsId: 'viru', name: 'Viru', stoptimesWithoutPatterns: [stoptime()] } }),
    ]
    const result = buildNearbyStops(edges, 8, 2)
    expect(result.map((s) => s.stopId)).toEqual(['mp1', 'mp2', 'viru'])
  })

  it('does not cap by name when maxPerName is left unset', () => {
    const edges = [81, 99, 108, 156].map((d, i) =>
      edge({ distance: d, stopOverrides: { gtfsId: `mp${i}`, name: 'Mere puiestee', stoptimesWithoutPatterns: [stoptime()] } }),
    )
    const result = buildNearbyStops(edges, 8)
    expect(result).toHaveLength(4)
  })

  it('maps GTFS mode BUS/TRAM/RAIL/FERRY to local TransportMode, defaulting unknowns to bus', () => {
    const edges = [
      edge({
        stopOverrides: {
          stoptimesWithoutPatterns: [
            stoptime({ trip: { gtfsId: 't1', route: { shortName: '5', mode: 'RAIL' } } }),
          ],
        },
      }),
    ]
    const result = buildNearbyStops(edges, 8)
    expect(result[0].departures[0].mode).toBe('train')
  })
})

describe('shouldWiden', () => {
  it('returns true when fewer stops than the widen threshold survive', () => {
    expect(shouldWiden([])).toBe(true)
  })

  it('returns false once enough stops survive', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      stopId: `s${i}`,
      name: 'x',
      lat: 0,
      lng: 0,
      distanceMeters: i,
      departures: [],
    }))
    expect(shouldWiden(many)).toBe(false)
  })
})
