import { foldName, scoreName, tokenize, distanceToNearestActiveCity } from './stop-search'
import { evaluateOpeningHours } from './opening-hours'
import { placeCategoryBySlug } from './place-categories'

// FTS5 query building + result ranking for POI search — kept as pure
// functions here (rather than inline in places-db.ts or the API route) so
// the matching rules are unit-testable without a real SQLite file, same
// split as nearby-stops.ts/stop-search.ts already use.

export interface PlaceRow {
  id: number
  name: string
  nameEn: string | null
  nameRu: string | null
  brand: string | null
  category: string
  lat: number
  lon: number
  openingHours: string | null
  addr: string | null
  city: string | null
  wheelchair: string | null
  rank: number
}

export interface PlaceResult {
  id: number
  name: string
  lat: number
  lng: number
  category: string
  addr: string | null
  city: string | null
  openingHours: string | null
  // Same convention as /api/geocode's own internal GeoResult.score: kept so
  // that route can merge places against stops and addresses on one
  // relevance scale (see rankPlaces below for why this can't just be
  // recomputed from `name` alone — a category-synonym match like "jõusaal"
  // -> "MyFitness" scores 0 against the name text). Never sent to the
  // client — the route strips it before responding, same as it already
  // does for stopId-search's internal score.
  score?: number
}

// FTS5 query text for `query`: each folded token becomes a prefix match
// (rimi* kris*), implicitly AND-ed by FTS5's default syntax — a multi-word
// query like "Rimi Kristiine" only matches a row containing both tokens
// somewhere across the indexed columns (name/name_alt/category_terms/addr),
// not necessarily adjacent. remove_diacritics on the FTS table (see
// scripts/build-places-db.ts's schema) already handles ä/ö/ü/õ/š/ž on the
// stored side; folding the query the same way here keeps both sides
// consistent, matching the same convention stop-search.ts's foldName uses
// for stop names.
//
// FTS5 special characters (", *, -, (, ) ...) inside a raw user query would
// otherwise throw a syntax error from the MATCH operator — tokenizing first
// and quoting each token defuses that, same as treating the query as plain
// words rather than a query-language expression a rider never intended to
// write.
export function buildPlaceQuery(query: string): string {
  const tokens = tokenize(query)
  if (tokens.length === 0) return ''
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ')
}

export interface RankPlacesOptions {
  activeCities: { lat: number; lng: number }[]
  maxPerName?: number
  now?: Date
}

interface ScoredPlace extends PlaceResult {
  score: number
  distanceToActive: number | null
  categoryRank: number
  openNow: boolean
}

// Re-scores FTS candidate rows with the exact same relevance ladder
// stop-search.ts's scoreName uses for transit stops (exact 1000 / prefix
// 500 / substring 250 / all-tokens 100) — so places and stops rank on one
// consistent scale in /api/geocode's merged results, rather than FTS5's own
// bm25 (a fundamentally different, incomparable scale) determining order
// against a stop's score.
export function rankPlaces(rows: PlaceRow[], query: string, opts: RankPlacesOptions): PlaceResult[] {
  const foldedQuery = foldName(query)
  const tokens = tokenize(query)
  const now = opts.now ?? new Date()
  const maxPerName = opts.maxPerName ?? Infinity

  const scored: ScoredPlace[] = rows.map((row) => {
    const nameCandidates = [row.name, row.nameEn, row.nameRu, row.brand].filter((n): n is string => !!n)
    const bestNameScore = Math.max(...nameCandidates.map((n) => scoreName(foldName(n), foldedQuery, tokens)), 0)
    // A query can match a row purely through a category synonym — "jõusaal"
    // finds every leisure=fitness_centre venue via category_terms in the FTS
    // index (see scripts/build-places-db.ts) even though the venue's own
    // name ("MyFitness") shares no text with the query at all. Re-scoring
    // against category terms the same way name candidates are scored (and
    // taking whichever is higher) is what keeps that row from being dropped
    // by the `score > 0` filter below despite FTS having legitimately
    // matched it.
    const category = placeCategoryBySlug(row.category)
    const categoryTermCandidates = category ? [...category.terms.en, ...category.terms.et, ...category.terms.ru] : []
    const bestCategoryScore = Math.max(...categoryTermCandidates.map((term) => scoreName(foldName(term), foldedQuery, tokens)), 0)
    const openState = row.openingHours ? evaluateOpeningHours(row.openingHours, now) : { state: 'unknown' as const }
    return {
      id: row.id,
      name: row.name,
      lat: row.lat,
      lng: row.lon,
      category: row.category,
      addr: row.addr,
      city: row.city,
      openingHours: row.openingHours,
      score: Math.max(bestNameScore, bestCategoryScore),
      distanceToActive: distanceToNearestActiveCity(row.lat, row.lon, opts.activeCities),
      categoryRank: row.rank,
      openNow: openState.state === 'open',
    }
  })

  const relevant = scored.filter((r) => r.score > 0)

  relevant.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    if (a.openNow !== b.openNow) return a.openNow ? -1 : 1
    if (a.categoryRank !== b.categoryRank) return b.categoryRank - a.categoryRank
    const da = a.distanceToActive ?? Infinity
    const db = b.distanceToActive ?? Infinity
    if (da !== db) return da - db
    return a.name.length - b.name.length
  })

  // Chain dedup: at most maxPerName results per folded name, so a query
  // matching a national chain (e.g. eight "Rimi" locations) doesn't crowd
  // out every other candidate — same maxPerName idea and rationale as
  // buildNearbyStops (nearby-stops.ts) applies to same-named stop platforms.
  const nameCounts = new Map<string, number>()
  const deduped: PlaceResult[] = []
  for (const place of relevant) {
    const key = foldName(place.name)
    const count = nameCounts.get(key) || 0
    if (count >= maxPerName) continue
    nameCounts.set(key, count + 1)
    deduped.push({
      id: place.id,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      category: place.category,
      addr: place.addr,
      city: place.city,
      openingHours: place.openingHours,
      score: place.score,
    })
  }
  return deduped
}
