import { CITIES } from './constants'
import { distanceMeters } from './delay'

// Stop-name search: folding, relevance ranking, and geographic clustering.
//
// Kept as pure functions here (rather than inline in /api/geocode) so the
// matching rules are unit-testable under jest's node environment — the same
// split plan-query.ts and nearby-stops.ts already use.

export interface SearchableStop {
  name: string
  lat: number
  lon: number
  gtfsId: string
}

// Estonian stop names use ä ö ü õ š ž, and ~30% of the country's served stop
// names (1990 of 6717, counted against the live graph) contain at least one.
// Riders routinely type without them — especially on a phone keyboard — so a
// diacritic-sensitive match makes a third of all stops unfindable. NFD splits
// the base letter from its combining mark, which the regex then drops; õ is
// o+tilde and š/ž are s/z+caron, so all six fold correctly. Folding is right
// for *search* even though Estonian alphabetizes these as distinct letters.
// Also trims: an untrimmed query (" Lille") previously matched nothing at all.
//
// The range below is the Unicode combining diacritical marks, U+0300-U+036F —
// the accent halves NFD splits off.
const COMBINING_MARKS = /[̀-ͯ]/g

export function foldName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
}

export function tokenize(query: string): string[] {
  return foldName(query).split(/\s+/).filter(Boolean)
}

// Relevance score for one folded stop name against a folded query. Higher
// wins; 0 means "not a match at all" and is filtered out.
//
// Replaces the previous raw index-insertion ordering, which had no notion of
// relevance: searching "Lille" put "Lilleküla" above the exact "Lille",
// and with a hard result cap an exact match could be truncated away entirely.
// Scoring by match quality also makes multi-word queries work — "Lille
// peatus" ("the Lille stop") still scores Lille via its matching token
// instead of returning nothing, which a whole-string `includes` did.
export function scoreName(foldedName: string, foldedQuery: string, tokens: string[]): number {
  if (foldedName === foldedQuery) return 1000
  if (foldedName.startsWith(foldedQuery)) return 500
  if (foldedName.includes(foldedQuery)) return 250
  if (tokens.length === 0) return 0
  const matched = tokens.filter((t) => foldedName.includes(t)).length
  if (matched === tokens.length) return 100
  return matched * 10
}

// Stops sharing a name are only the same place when they're actually near
// each other. Verified live: 8 stops are named "Lille", spread across
// Tallinn, Tartu, Elva, Kuressaare and Kohila — merging them nationwide
// (what the old code did) produced one result whose coordinates were an
// arbitrary town's, so picking "Lille" in Tallinn flew the map to Elva and
// opened a departure board blending five towns together.
//
// Greedy single-link clustering against each cluster's first (seed) member.
// Fine at this scale: a name is shared by a handful of stops at most, and
// the alternative (proper agglomerative clustering) would chain platforms
// across a whole city for names like "Kesklinn".
export function clusterByLocation<T extends { lat: number; lon: number }>(
  stops: T[],
  maxSpreadM: number,
): T[][] {
  const clusters: T[][] = []
  for (const stop of stops) {
    const hit = clusters.find(
      (c) => distanceMeters(c[0].lat, c[0].lon, stop.lat, stop.lon) <= maxSpreadM,
    )
    if (hit) hit.push(stop)
    else clusters.push([stop])
  }
  return clusters
}

// Nearest known city to a coordinate, for disambiguating same-named stops in
// the dropdown ("Lille — Tallinn" vs "Lille — Elva"). Reuses the existing
// CITIES list rather than introducing a locality data source; returns null
// beyond maxDistanceM so a rural stop isn't mislabelled with a city it has
// nothing to do with.
export function nearestCityName(lat: number, lng: number, maxDistanceM: number): string | null {
  let best: { name: string; dist: number } | null = null
  for (const city of CITIES) {
    const dist = distanceMeters(lat, lng, city.lat, city.lng)
    if (!best || dist < best.dist) best = { name: city.name, dist }
  }
  return best && best.dist <= maxDistanceM ? best.name : null
}

// Smallest distance from a stop cluster to any of the cities the rider
// currently has selected, or null when no cities are active. Used to bias
// ranking toward where the rider actually is: a Tallinn rider searching a
// name that exists in six towns should get Tallinn's first.
export function distanceToNearestActiveCity(
  lat: number,
  lng: number,
  activeCities: { lat: number; lng: number }[],
): number | null {
  if (activeCities.length === 0) return null
  let min = Infinity
  for (const city of activeCities) {
    const dist = distanceMeters(lat, lng, city.lat, city.lng)
    if (dist < min) min = dist
  }
  return min
}
