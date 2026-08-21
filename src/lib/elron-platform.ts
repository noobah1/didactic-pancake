import { ELRON_LIVE_MAP_STOP_URL, ELRON_PLATFORM_CACHE_TTL, ELRON_STATION_NAME_ALIASES } from './constants'
import { foldName } from './stop-search'

// Elron's live-map board for one station — see ELRON_LIVE_MAP_STOP_URL for
// how this endpoint was found and validated. Only the fields used below are
// declared; the endpoint returns several more (kuupaev, lisateade,
// pohjus_teade, reisi_staatus) that nothing here needs.
export interface ElronBoardRow {
  plaaniline_aeg: string // scheduled HH:MM, station-local (Europe/Tallinn)
  liin: string // "Tallinn - Tartu" — origin/destination pair, not a route number
  sihtjaam: string // final destination station name
  peatuskoht: string // platform/track number — the field this module exists for
  peatuskoht_muutunud: string // 't'/'f' — platform changed from the originally published one
  // 't'/'f' — this row is the train's terminus at this station rather than a
  // stop it continues through. NOT filtered out below: verified live that a
  // terminus row still carries a real peatuskoht (e.g. reis 658 Turba-Tallinn
  // terminating at Tallinn on platform 6) — a rider on an inbound train wants
  // its arrival platform just as much as one on an outbound departure.
  reisi_lopp_peatus: string
}

export interface StationPlatform {
  platform: string
  changed: boolean
}

// Keyed on scheduled HH:MM + folded destination — see fetchStationPlatforms.
export type PlatformIndex = Map<string, StationPlatform>

const cache = new Map<string, { data: PlatformIndex; timestamp: number }>()

// Returns the name to actually send to Elron's endpoint. Confirmed live that
// endpoint is case-insensitive ("tallinn" and "Tallinn" return identical
// data) but NOT diacritic-insensitive — "ulemiste" 404s-with-no-data
// ("Pole andmeid") while "%C3%9Clemiste" (Ülemiste) returns a full board, and
// likewise "turi" vs "Türi". So this must return the ORIGINAL name (which
// still carries its diacritics) unless it's one of the ELRON_STATION_NAME_
// ALIASES exceptions, whose values are themselves the exact string Elron
// expects — never fold the diacritics away as part of "resolving" a name.
function resolveStationName(originalName: string, foldedName: string): string {
  return ELRON_STATION_NAME_ALIASES[foldedName] || originalName
}

export function buildIndex(rows: ElronBoardRow[]): PlatformIndex {
  const index: PlatformIndex = new Map()
  // Group by scheduled time first so a same-minute collision (two trains
  // departing the same station at once, common at junctions like Keila) only
  // gets keyed by destination when there's actually more than one candidate —
  // otherwise the destination fold is redundant precision that just adds a
  // second way for the key to fail to match.
  const byTime = new Map<string, ElronBoardRow[]>()
  for (const row of rows) {
    const list = byTime.get(row.plaaniline_aeg)
    if (list) list.push(row)
    else byTime.set(row.plaaniline_aeg, [row])
  }
  for (const [time, group] of byTime) {
    if (group.length === 1) {
      index.set(time, { platform: group[0].peatuskoht, changed: group[0].peatuskoht_muutunud === 't' })
      continue
    }
    // Ambiguous minute — only resolvable per-destination. A time-only key
    // would silently overwrite with whichever row came last.
    for (const row of group) {
      index.set(`${time}|${foldName(row.sihtjaam)}`, {
        platform: row.peatuskoht,
        changed: row.peatuskoht_muutunud === 't',
      })
    }
  }
  return index
}

// Fetches (or returns cached) the full-day board index for one station. One
// call per distinct station name, regardless of how many departures a caller
// needs platforms for — callers should fetch once and reuse the index via
// resolvePlatform rather than calling this per-departure.
export async function fetchStationPlatformIndex(stationName: string): Promise<PlatformIndex | null> {
  const folded = foldName(stationName)
  // Cache is keyed on the FOLDED name (so "Tallinn"/"tallinn" share one
  // entry) — never on the request name, which for most stations still
  // carries diacritics/casing straight from GTFS and would otherwise splinter
  // the cache per input variant.
  const cached = cache.get(folded)
  if (cached && Date.now() - cached.timestamp < ELRON_PLATFORM_CACHE_TTL) {
    return cached.data
  }
  try {
    const requestName = resolveStationName(stationName, folded)
    const response = await fetch(`${ELRON_LIVE_MAP_STOP_URL}${encodeURIComponent(requestName)}`, {
      // Cloudflare 403s a request with no browser-like User-Agent.
      headers: { 'User-Agent': 'LiveTravely/1.0 (+https://github.com/noobah1/didactic-pancake)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return cached?.data ?? null
    const body = await response.json()
    // "Pole andmeid" (no data) for stations Elron doesn't serve today (e.g.
    // a line currently suspended) — body.data is an object, not an array.
    const rows: ElronBoardRow[] = Array.isArray(body?.data) ? body.data : []
    const index = buildIndex(rows)
    cache.set(folded, { data: index, timestamp: Date.now() })
    return index
  } catch {
    // Undocumented third-party endpoint — a platform badge is a nice-to-have,
    // never worth failing the whole departure board over.
    return cached?.data ?? null
  }
}

// Looks up one departure's platform in an index already fetched via
// fetchStationPlatformIndex. scheduledHHMM must be the station-local
// (Europe/Tallinn) scheduled time, formatted "HH:MM" — Elron's board is keyed
// on the originally scheduled time, not a live/delayed one.
export function resolvePlatform(
  index: PlatformIndex,
  scheduledHHMM: string,
  destination: string,
): StationPlatform | undefined {
  return index.get(scheduledHHMM) ?? index.get(`${scheduledHHMM}|${foldName(destination)}`)
}
