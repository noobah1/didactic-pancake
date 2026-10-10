import { dedupeDepartures, dedupeItineraries, isStaleFeedTrip } from '../feed-dedupe'

const dep = (tripId: string, extra: Partial<Parameters<typeof dedupeDepartures>[0][number]> = {}) => ({
  tripId, line: 'R12', mode: 'train', headsign: 'Keila', departureEpochSec: 1000, ...extra,
})

describe('feed dedupe', () => {
  it('flags only the stale second feed', () => {
    expect(isStaleFeedTrip('2:abc')).toBe(true)
    expect(isStaleFeedTrip('1:abc')).toBe(false)
    expect(isStaleFeedTrip('3:abc')).toBe(false)
  })

  it('drops stale-feed departures', () => {
    expect(dedupeDepartures([dep('2:x'), dep('1:y', { departureEpochSec: 2000 })]).map((d) => d.tripId)).toEqual(['1:y'])
  })

  it('collapses the same ride from two feeds, preferring the unified feed, keeping order', () => {
    const out = dedupeDepartures([dep('3:v', { line: 'VK' }), dep('1:v', { line: 'VK' }), dep('1:z', { line: '5', mode: 'bus' })])
    expect(out.map((d) => d.tripId)).toEqual(['1:v', '1:z'])
  })

  it('keeps different departures of the same line', () => {
    expect(dedupeDepartures([dep('1:a'), dep('1:b', { departureEpochSec: 1600 })])).toHaveLength(2)
  })

  const it1 = (tripId: string, start = 1) => ({
    startTime: start,
    endTime: 9,
    legs: [{ mode: 'RAIL', route: { shortName: 'R12' }, trip: { gtfsId: tripId }, from: { name: 'A' }, to: { name: 'B' } }],
  })

  it('removes itineraries on the stale feed and exact duplicates', () => {
    expect(dedupeItineraries([it1('2:a'), it1('1:b'), it1('3:c'), it1('1:d', 2)])).toHaveLength(2)
  })

  it('falls back to the stale itineraries when nothing else exists', () => {
    expect(dedupeItineraries([it1('2:a')])).toHaveLength(1)
  })
})
