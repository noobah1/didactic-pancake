import { buildPlaceQuery, rankPlaces, PlaceRow } from '../place-search'

function row(overrides: Partial<PlaceRow> = {}): PlaceRow {
  return {
    id: 1,
    name: 'Rimi Kristiine',
    nameEn: null,
    nameRu: null,
    brand: 'Rimi',
    category: 'supermarket',
    lat: 59.42,
    lon: 24.71,
    openingHours: null,
    addr: 'Endla 45',
    city: 'Tallinn',
    wheelchair: null,
    rank: 85,
    ...overrides,
  }
}

describe('buildPlaceQuery', () => {
  it('builds a prefix-match query from a single word', () => {
    expect(buildPlaceQuery('rimi')).toBe('"rimi"*')
  })

  it('AND-combines multiple tokens as separate prefix matches', () => {
    expect(buildPlaceQuery('rimi kristiine')).toBe('"rimi"* "kristiine"*')
  })

  it('folds diacritics the same way stop search does', () => {
    expect(buildPlaceQuery('jõusaal')).toBe('"jousaal"*')
  })

  it('returns an empty string for a query with no real tokens', () => {
    expect(buildPlaceQuery('   ')).toBe('')
  })

  it('escapes an embedded double quote so FTS5 MATCH syntax cannot break', () => {
    // tokenize() lowercases and folds but does not strip quote characters —
    // buildPlaceQuery must still produce a syntactically valid FTS5 query.
    expect(buildPlaceQuery('a"b')).toBe('"a""b"*')
  })
})

describe('rankPlaces', () => {
  it('ranks an exact name match above a substring match', () => {
    const rows = [
      row({ id: 1, name: 'Rimi Kristiine' }),
      row({ id: 2, name: 'Rimi' }),
    ]
    const results = rankPlaces(rows, 'Rimi', { activeCities: [] })
    expect(results.map((r) => r.id)).toEqual([2, 1])
  })

  it('drops rows that score zero against the query', () => {
    const rows = [row({ id: 1, name: 'Rimi' }), row({ id: 2, name: 'Selver', brand: 'Selver' })]
    const results = rankPlaces(rows, 'rimi', { activeCities: [] })
    expect(results.map((r) => r.id)).toEqual([1])
  })

  it('matches via an alternate-language name when the primary name does not match', () => {
    const rows = [row({ id: 1, name: 'Apteek 1000', nameEn: 'Pharmacy 1000' })]
    const results = rankPlaces(rows, 'pharmacy', { activeCities: [] })
    expect(results).toHaveLength(1)
  })

  it('breaks a tied score by open-now status', () => {
    const rows = [
      row({ id: 1, name: 'Chain Store', openingHours: 'Mo-Su 00:00-23:59' }), // effectively always open
      row({ id: 2, name: 'Chain Store', openingHours: 'Mo-Su 00:00-00:01' }), // effectively always closed
    ]
    const now = new Date('2026-01-05T10:00:00+02:00')
    const results = rankPlaces(rows, 'Chain Store', { activeCities: [], now })
    expect(results[0].id).toBe(1)
  })

  it('breaks a further tie by category prominence rank', () => {
    const rows = [
      row({ id: 1, name: 'Foo', category: 'atm', rank: 35 }),
      row({ id: 2, name: 'Foo', category: 'mall', rank: 90 }),
    ]
    const results = rankPlaces(rows, 'Foo', { activeCities: [] })
    expect(results[0].id).toBe(2)
  })

  it('caps same-named results at maxPerName (chain dedup)', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row({ id: i, name: 'Rimi', lat: 59.4 + i * 0.001 }))
    const results = rankPlaces(rows, 'Rimi', { activeCities: [], maxPerName: 2 })
    expect(results).toHaveLength(2)
  })

  it('does not cap distinctly named results even with maxPerName set', () => {
    const rows = [row({ id: 1, name: 'Rimi Kristiine' }), row({ id: 2, name: 'Rimi Mustika' })]
    const results = rankPlaces(rows, 'Rimi', { activeCities: [], maxPerName: 2 })
    expect(results).toHaveLength(2)
  })

  it('matches via a category synonym even when the venue name shares no text with the query', () => {
    // "jõusaal" is the Estonian synonym for the 'gym' category (see
    // place-categories.ts) — a venue named "MyFitness" has no textual
    // overlap with that query at all, so this only works if rankPlaces also
    // scores against the category's own terms, not just the name fields.
    const rows = [row({ id: 1, name: 'MyFitness', category: 'gym', brand: null })]
    const results = rankPlaces(rows, 'jõusaal', { activeCities: [] })
    expect(results.map((r) => r.id)).toEqual([1])
  })

  it('does not match via an unrelated category\'s synonyms', () => {
    const rows = [row({ id: 1, name: 'MyFitness', category: 'gym', brand: null })]
    const results = rankPlaces(rows, 'apteek', { activeCities: [] }) // Estonian for "pharmacy"
    expect(results).toHaveLength(0)
  })

  it('prefers the candidate nearer an active city when scores and open state tie', () => {
    const tallinn = { lat: 59.437, lng: 24.7536 }
    const rows = [
      row({ id: 1, name: 'Foo Tartu', lat: 58.378, lon: 26.729 }),
      row({ id: 2, name: 'Foo Tallinn', lat: 59.44, lon: 24.75 }),
    ]
    const results = rankPlaces(rows, 'Foo', { activeCities: [tallinn] })
    expect(results[0].id).toBe(2)
  })
})
