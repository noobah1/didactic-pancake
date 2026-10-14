import { mergeSplitLegs } from '../merge-split-legs'
import { RouteLeg } from '../types'

const BASE = Date.parse('2026-10-14T10:00:00Z')
const place = (name: string) => ({ name, lat: 59, lng: 24, stopId: `1:${name}` })

function leg(from: string, to: string, startMin: number, endMin: number, extra: Partial<RouteLeg> = {}): RouteLeg {
  return {
    mode: 'bus',
    from: place(from),
    to: place(to),
    startTime: new Date(BASE + startMin * 60_000).toISOString(),
    endTime: new Date(BASE + endMin * 60_000).toISOString(),
    duration: (endMin - startMin) * 60,
    route: '5',
    routeGtfsId: '1:5',
    tripId: '1:t1',
    ...extra,
  }
}

describe('mergeSplitLegs', () => {
  it('joins one trip split into two legs', () => {
    const merged = mergeSplitLegs([leg('A', 'B', 0, 10), leg('B', 'C', 10, 20)])
    expect(merged).toHaveLength(1)
    expect(merged[0].from.name).toBe('A')
    expect(merged[0].to.name).toBe('C')
    expect(merged[0].duration).toBe(20 * 60)
    expect(merged[0].intermediateStops).toBeUndefined()
  })

  it('joins the same line continuing as another trip at the same stop', () => {
    expect(mergeSplitLegs([leg('A', 'B', 0, 10), leg('B', 'C', 13, 25, { tripId: '1:t2' })])).toHaveLength(1)
  })

  it('keeps the joining stop as an intermediate stop', () => {
    const merged = mergeSplitLegs([
      leg('A', 'B', 0, 10, { intermediateStops: [place('X')] }),
      leg('B', 'C', 10, 20, { intermediateStops: [place('Y')] }),
    ])
    expect(merged[0].intermediateStops?.map((s) => s.name)).toEqual(['X', 'B', 'Y'])
  })

  it('keeps a real transfer to a different line', () => {
    expect(mergeSplitLegs([leg('A', 'B', 0, 10), leg('B', 'C', 15, 25, { route: '7', routeGtfsId: '1:7', tripId: '1:t3' })])).toHaveLength(2)
  })

  it('keeps the same line when the second leg starts at another stop', () => {
    expect(mergeSplitLegs([leg('A', 'B', 0, 10), leg('D', 'C', 12, 25, { tripId: '1:t2' })])).toHaveLength(2)
  })

  it('keeps the same line again after a long wait', () => {
    expect(mergeSplitLegs([leg('A', 'B', 0, 10), leg('B', 'C', 40, 50, { tripId: '1:t2' })])).toHaveLength(2)
  })

  it('never merges walking legs', () => {
    const walk = (a: string, b: string, s: number, e: number) => leg(a, b, s, e, { mode: 'walk', route: undefined, routeGtfsId: undefined, tripId: undefined })
    expect(mergeSplitLegs([walk('A', 'B', 0, 5), walk('B', 'C', 5, 10)])).toHaveLength(2)
  })
})
