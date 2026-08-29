import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import { buildPlaceQuery, rankPlaces, PlaceRow, PlaceResult } from './place-search'

// Read-only handle onto the POI database built by scripts/build-places-db.ts
// from the same OSM extract OTP's graph is built from (see otp/data/
// estonia-latest.osm.pbf) — see Markdown.md §"Where to start: adding an
// upstream feed" for the app's own rule that a new data source gets its own
// src/lib/<feed>.ts, never called from the browser.
//
// Deliberately its own file location resolver (not a reuse of db.ts's
// getDb()) — that database is a read/write traffic-sample store the app
// itself writes to continuously; this one is a static, read-only file an
// external process (otp/sync-places.sh) replaces wholesale out from under
// the running app. Sharing one connection-management module between two
// very different lifecycles (one grows forever, one is swapped atomically)
// would make both harder to reason about for no benefit — they only happen
// to both be SQLite.
const PLACES_DIR = process.env.TRAFFIC_DATA_DIR || defaultDataDir()

function defaultDataDir(): string {
  // Same reasoning and same directory as src/lib/db.ts's own
  // defaultDataDir: a cloud-synced folder (OneDrive et al.) rewrites a
  // SQLite file out from under an open handle and corrupts it — see that
  // file's own comment for the incident this is named after. Sharing the
  // directory (not the file) with the traffic database means both are kept
  // out of the synced tree by the same one rule instead of two to remember.
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'livetravel', 'traffic-data')
  }
  return path.join(process.cwd(), 'traffic-data')
}

function resolvePlacesDbPath(): string {
  return process.env.PLACES_DB_PATH || path.join(PLACES_DIR, 'places.db')
}

interface OpenHandle {
  db: DatabaseSync
  path: string
  mtimeMs: number
}

let handle: OpenHandle | null = null
// Once the file is confirmed missing/corrupt, remember that rather than
// re-stat and re-attempt-open on every single search — place search is
// strictly additive (see searchPlaces below) and a dev environment or a
// server between its first deploy and its first otp/sync-places.sh run is
// expected to run with no places.db at all, indefinitely.
let knownUnavailable = false

function statMtime(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs
  } catch {
    return null
  }
}

// otp/sync-places.sh swaps the file with an atomic `mv` (see that script) —
// the running process's already-open handle keeps reading the old, now-
// unlinked inode until this notices the mtime moved and reopens. This is
// deliberately simpler than db.ts's/sync-graph.sh's container-restart dance:
// nothing here is ever written to, so there's no corruption risk from an
// in-place rewrite, and a reopen is cheap enough to just check before every
// query instead of needing an external trigger.
function getHandle(): OpenHandle | null {
  if (knownUnavailable) return null

  const resolvedPath = resolvePlacesDbPath()
  const mtimeMs = statMtime(resolvedPath)
  if (mtimeMs === null) {
    // Missing is the expected state until the first sync — not an error
    // worth logging on every request.
    if (handle) handle.db.close()
    handle = null
    return null
  }

  if (handle && handle.path === resolvedPath && handle.mtimeMs === mtimeMs) return handle

  handle?.db.close()
  try {
    const db = new DatabaseSync(resolvedPath, { readOnly: true })
    const check = db.prepare('PRAGMA quick_check(1)').all() as { quick_check: string }[]
    if (check.length !== 1 || check[0].quick_check !== 'ok') {
      console.error(`[places-db] ${resolvedPath} failed quick_check — treating place search as unavailable`)
      db.close()
      knownUnavailable = true
      handle = null
      return null
    }
    handle = { db, path: resolvedPath, mtimeMs }
    return handle
  } catch (error) {
    console.error(`[places-db] could not open ${resolvedPath}:`, error)
    knownUnavailable = true
    handle = null
    return null
  }
}

interface SearchPlacesOptions {
  limit: number
  activeCities: { lat: number; lng: number }[]
  now?: Date
  // Restricts results to these category slugs (see place-categories.ts) —
  // used by /api/geocode's Departures-tab search to limit place matches to
  // accommodation only. Applied in SQL, before the 100-row over-fetch below,
  // so a category filter can't be starved out by unrelated text-heavy
  // matches the way a post-hoc JS filter would allow.
  categories?: string[]
}

// Never throws: place search is strictly additive on top of transit-stop
// and address search in /api/geocode (see that route), and a missing,
// stale, or corrupt places.db must never be able to break the two search
// paths that already work today. Every failure mode here — file absent,
// open failed, quick_check failed, query threw — resolves to an empty
// array, exactly like searchEstonianAddresses's own `catch { return [] }`.
export function searchPlaces(query: string, opts: SearchPlacesOptions): PlaceResult[] {
  const h = getHandle()
  if (!h) return []

  const matchQuery = buildPlaceQuery(query)
  if (!matchQuery) return []

  try {
    // Over-fetch beyond opts.limit before rankPlaces's own scoring/dedup —
    // FTS5's bm25 ordering is not the ordering we actually want (see
    // place-search.ts), so this needs enough raw candidates that the
    // re-ranked, deduped top `limit` is still meaningfully complete rather
    // than an arbitrary FTS-ranked prefix.
    const categoryFilter = opts.categories && opts.categories.length > 0
      ? `AND p.category IN (${opts.categories.map(() => '?').join(', ')})`
      : ''
    const rows = h.db
      .prepare(
        `SELECT p.id, p.name, p.name_en, p.name_ru, p.brand, p.category, p.lat, p.lon,
                p.opening_hours, p.addr, p.city, p.wheelchair, p.rank
         FROM place_fts f
         JOIN place p ON p.id = f.rowid
         WHERE place_fts MATCH ?
         ${categoryFilter}
         LIMIT 100`,
      )
      .all(matchQuery, ...(opts.categories ?? [])) as Record<string, unknown>[]

    const placeRows: PlaceRow[] = rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      nameEn: r.name_en == null ? null : String(r.name_en),
      nameRu: r.name_ru == null ? null : String(r.name_ru),
      brand: r.brand == null ? null : String(r.brand),
      category: String(r.category),
      lat: Number(r.lat),
      lon: Number(r.lon),
      openingHours: r.opening_hours == null ? null : String(r.opening_hours),
      addr: r.addr == null ? null : String(r.addr),
      city: r.city == null ? null : String(r.city),
      wheelchair: r.wheelchair == null ? null : String(r.wheelchair),
      rank: Number(r.rank),
    }))

    return rankPlaces(placeRows, query, { activeCities: opts.activeCities, maxPerName: 2, now: opts.now }).slice(0, opts.limit)
  } catch (error) {
    console.error('[places-db] search query failed:', error)
    return []
  }
}

// Test-only: force the next search to re-stat and reopen, even if the
// resolved path hasn't changed — mirrors db.ts's __resetDbForTests.
export function __resetPlacesDbForTests(): void {
  handle?.db.close()
  handle = null
  knownUnavailable = false
}
