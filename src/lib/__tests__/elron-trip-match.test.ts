import { elronTripMatchKey, resolveElronTrip } from '../elron-trip-match'

// Real ids: the live feed's (new timetable) and the stale graph's (old one).
// Only the service period, day and trailing hash differ between publications.
const FEED_LAANE = 'Laane_31.08.-31.12.2026-Sa-72ac5cefcee5ed431883a4d7b2aee038-A-IB-1740-759b85e'
const STALE_LAANE = '1:Laane_26.01-31.12026.02.2026-Sa-72ac5cefcee5ed431883a4d7b2aee038-A-IB-1740-009c128'
const FEED_IDA_VARIANT = 'Ida,_Lõuna_31.08-1.11.2026-Sa-elron00003-Variant_-_A-OB-1427-aede99f'
const FEED_IDA_SHORT = 'Ida,_Lõuna_31.08-1.11.2026-Sa-elron00001-A-B--1650-15752ef'

// Tallinn → Keila-ish shape, lng/lat pairs like decodePolyline returns.
const SHAPE: [number, number][] = [
  [24.7, 59.43],
  [24.6, 59.35],
  [24.4, 59.3],
]
const onShape = { lat: 59.35, lng: 24.6 }
const farAway = { lat: 58.2, lng: 26.5 }

const trip = (shapeCoords: [number, number][] | null = SHAPE) => ({ line: 'x', destination: 'y', shapeCoords })

describe('elronTripMatchKey', () => {
  it('is identical across timetable publications', () => {
    expect(elronTripMatchKey(FEED_LAANE)).toBe(elronTripMatchKey(STALE_LAANE))
    expect(elronTripMatchKey(FEED_LAANE)).toBe('Laane|72ac5cefcee5ed431883a4d7b2aee038-A-IB-1740')
  })

  it('handles variant and short-form ids', () => {
    expect(elronTripMatchKey(FEED_IDA_VARIANT)).toBe('Ida,|elron00003-Variant_-_A-OB-1427')
    expect(elronTripMatchKey(FEED_IDA_SHORT)).toBe('Ida,|elron00001-A-B--1650')
  })

  it('distinguishes departure time and direction', () => {
    expect(elronTripMatchKey(FEED_LAANE)).not.toBe(elronTripMatchKey(FEED_LAANE.replace('1740', '1750')))
    expect(elronTripMatchKey(FEED_LAANE)).not.toBe(elronTripMatchKey(FEED_LAANE.replace('-IB-', '-OB-')))
  })

  it('returns null for ids that do not look like Elron trips', () => {
    expect(elronTripMatchKey('10000')).toBeNull()
    expect(elronTripMatchKey('1:Laane_31.08.-31.12.2026-Sa-abc-A-IB-nohhmm-759b85e')).toBeNull()
  })
})

describe('resolveElronTrip', () => {
  it('prefers an exact id match', () => {
    const trips = new Map([[`1:${FEED_LAANE}`, trip()]])
    const r = resolveElronTrip(`1:${FEED_LAANE}`, onShape.lat, onShape.lng, trips)
    expect(r?.via).toBe('exact')
    expect(r?.tripId).toBe(`1:${FEED_LAANE}`)
  })

  it('falls back to the version-independent key and returns the GRAPH id', () => {
    const trips = new Map([[STALE_LAANE, trip()]])
    const r = resolveElronTrip(`1:${FEED_LAANE}`, onShape.lat, onShape.lng, trips)
    expect(r?.via).toBe('fuzzy')
    expect(r?.tripId).toBe(STALE_LAANE)
  })

  it('refuses an ambiguous fuzzy match', () => {
    const other = STALE_LAANE.replace('-009c128', '-ffffff1')
    const trips = new Map([[STALE_LAANE, trip()], [other, trip()]])
    expect(resolveElronTrip(`1:${FEED_LAANE}`, onShape.lat, onShape.lng, trips)).toBeNull()
  })

  it('refuses a fuzzy match when the train is nowhere near the trip shape', () => {
    const trips = new Map([[STALE_LAANE, trip()]])
    expect(resolveElronTrip(`1:${FEED_LAANE}`, farAway.lat, farAway.lng, trips)).toBeNull()
  })

  it('accepts a fuzzy match when the graph has no shape to contradict it', () => {
    const trips = new Map([[STALE_LAANE, trip(null)]])
    expect(resolveElronTrip(`1:${FEED_LAANE}`, farAway.lat, farAway.lng, trips)?.via).toBe('fuzzy')
  })

  it('returns null when nothing matches at all', () => {
    expect(resolveElronTrip(`1:${FEED_LAANE}`, onShape.lat, onShape.lng, new Map())).toBeNull()
    expect(resolveElronTrip('garbage', onShape.lat, onShape.lng, new Map([[STALE_LAANE, trip()]]))).toBeNull()
  })
})
