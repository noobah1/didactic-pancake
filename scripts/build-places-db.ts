/**
 * Builds otp/data/places.db — the POI database behind /api/geocode's place
 * search (see src/lib/places-db.ts) — from an osmium-filtered extract of the
 * same OSM data OTP's own graph is built from (otp/data/estonia-latest.osm.pbf).
 *
 * OTP throws away every non-routing OSM tag when it builds its street graph
 * — amenity=*, shop=*, leisure=* etc. are read from the exact same .pbf file
 * and never surfaced. This script is what turns that already-downloaded data
 * into "search for a gym/restaurant/pharmacy by name".
 *
 * Pipeline (see .github/workflows/build-places-db.yml for the full CI job):
 *
 *   osmium tags-filter estonia-latest.osm.pbf \
 *     nwr/amenity nwr/shop nwr/leisure nwr/tourism nwr/office nwr/healthcare \
 *     -o poi.osm.pbf
 *   osmium export poi.osm.pbf -f geojsonseq -o poi.geojsonseq
 *   TS_NODE_FILES=true npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/build-places-db.ts poi.geojsonseq places.db
 *
 * TS_NODE_FILES=true is required (unlike scripts/generate-city-probes.ts) —
 * ts-node's default per-file transpilation doesn't pick up the ambient
 * `declare module 'node:sqlite'` in src/lib/node-sqlite.d.ts unless it's
 * told to load the whole tsconfig `include` set up front.
 *
 * osmium export emits one GeoJSON Text Sequence record (RFC 8142 — each
 * record optionally prefixed with an ASCII Record Separator, 0x1E) per OSM
 * element: a Point for a node, a Polygon/MultiPolygon/LineString for a way
 * or relation. Non-point geometries are reduced to their bounding-box
 * centre — close enough for a shop's building (a few metres from its real
 * entrance), and OTP snaps the walk leg onto the street network regardless.
 */
import { createReadStream, existsSync, unlinkSync } from 'fs'
import { createInterface } from 'readline'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { categoryForTags, PlaceCategory } from '../src/lib/place-categories'
import { foldName, nearestCityName } from '../src/lib/stop-search'
import { distanceMeters } from '../src/lib/delay'

// How far a place can sit from the nearest known city and still be labelled
// with it — matches STOP_SEARCH_CITY_LABEL_RADIUS_M's own reasoning
// (constants.ts): a rural venue beyond this gets no city label rather than
// a misleading one.
const CITY_LABEL_RADIUS_M = 30_000
// Two elements with the same folded name and category within this distance
// are almost certainly the same real-world venue tagged twice (a POI node
// plus its containing building way) — verified against real OSM data, where
// this is a common double-tagging pattern for supermarkets and malls.
const DEDUP_RADIUS_M = 50
// A real full build of Estonia's OSM extract (~1.3M population, ~40 tracked
// categories) lands around 10.5-11k named+categorized rows after dedup — see
// the "By category" breakdown this script prints. Floor set comfortably
// below that, not at some larger guess: this only needs to catch a genuinely
// broken/truncated extract, not second-guess a legitimately small country.
const MIN_EXPECTED_ROWS = 8_000

interface RawFeature {
  type: 'Feature'
  properties: Record<string, string>
  geometry: {
    type: 'Point' | 'LineString' | 'Polygon' | 'MultiPolygon'
    coordinates: unknown
  }
}

interface ExtractedPlace {
  osmId: string // "<type>/<id>" from osmium's @id, used only for de-dup logging
  name: string
  nameEn: string | null
  nameRu: string | null
  brand: string | null
  category: PlaceCategory
  lat: number
  lon: number
  openingHours: string | null
  addr: string | null
  city: string | null
  wheelchair: string | null
  phone: string | null
  website: string | null
  tagCount: number
}

function flattenCoordinates(coords: unknown, out: [number, number][]): void {
  if (Array.isArray(coords) && typeof coords[0] === 'number') {
    out.push(coords as [number, number])
    return
  }
  if (Array.isArray(coords)) {
    for (const c of coords) flattenCoordinates(c, out)
  }
}

// Point geometry -> its own coordinate; any other geometry -> the centre of
// its bounding box. Good enough for search/routing purposes — see the file
// header comment.
function centroid(geometry: RawFeature['geometry']): { lat: number; lon: number } | null {
  if (geometry.type === 'Point') {
    const [lon, lat] = geometry.coordinates as [number, number]
    if (typeof lat !== 'number' || typeof lon !== 'number') return null
    return { lat, lon }
  }
  const points: [number, number][] = []
  flattenCoordinates(geometry.coordinates, points)
  if (points.length === 0) return null
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity
  for (const [lon, lat] of points) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
  }
  return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 }
}

function buildAddr(tags: Record<string, string>): string | null {
  const street = tags['addr:street']
  const house = tags['addr:housenumber']
  if (street && house) return `${street} ${house}`
  return street || null
}

function extractPlace(feature: RawFeature): ExtractedPlace | null {
  const tags = feature.properties
  const name = tags.name
  if (!name) return null // unnamed elements (benches, bins, unlabeled parking bays) are noise here — see the file header

  const category = categoryForTags(tags)
  if (!category) return null

  const point = centroid(feature.geometry)
  if (!point) return null

  const osmId = String((tags as unknown as { '@id'?: string })['@id'] ?? `${point.lat},${point.lon}`)
  const tagCount = Object.keys(tags).filter((k) => !k.startsWith('@')).length

  return {
    osmId,
    name,
    nameEn: tags['name:en'] || null,
    nameRu: tags['name:ru'] || null,
    brand: tags.brand || tags.operator || null,
    category,
    lat: point.lat,
    lon: point.lon,
    openingHours: tags.opening_hours || null,
    addr: buildAddr(tags),
    city: tags['addr:city'] || nearestCityName(point.lat, point.lon, CITY_LABEL_RADIUS_M),
    wheelchair: tags.wheelchair || null,
    phone: tags.phone || tags['contact:phone'] || null,
    website: tags.website || tags['contact:website'] || null,
    tagCount,
  }
}

// Same venue tagged twice (a POI node plus its containing building way) —
// keep whichever record carries more tags, since that's the one more likely
// to be the deliberately-maintained entry rather than a stub. Runs after
// every place for the same folded-name+category pair has been collected, so
// it's O(n²) only within one name/category bucket (a handful of candidates
// at most), not across the whole ~90k-row dataset.
function dedupe(places: ExtractedPlace[]): ExtractedPlace[] {
  const byKey = new Map<string, ExtractedPlace[]>()
  for (const place of places) {
    const key = `${foldName(place.name)}::${place.category.slug}`
    const list = byKey.get(key)
    if (list) list.push(place)
    else byKey.set(key, [place])
  }

  const result: ExtractedPlace[] = []
  for (const bucket of byKey.values()) {
    const kept: ExtractedPlace[] = []
    for (const candidate of bucket) {
      const dupeIdx = kept.findIndex((k) => distanceMeters(k.lat, k.lon, candidate.lat, candidate.lon) <= DEDUP_RADIUS_M)
      if (dupeIdx === -1) {
        kept.push(candidate)
      } else if (candidate.tagCount > kept[dupeIdx].tagCount) {
        kept[dupeIdx] = candidate
      }
    }
    result.push(...kept)
  }
  return result
}

function rankFor(place: ExtractedPlace): number {
  let rank = place.category.rank
  if (place.brand) rank += 5
  if (place.website) rank += 3
  if (place.openingHours) rank += 2
  return rank
}

function categoryTerms(category: PlaceCategory): string {
  return [...category.terms.en, ...category.terms.et, ...category.terms.ru].join(' ')
}

async function readFeatures(inputPath: string): Promise<AsyncIterable<RawFeature>> {
  const rl = createInterface({ input: createReadStream(inputPath, { encoding: 'utf8' }), crlfDelay: Infinity })
  async function* iterate() {
    for await (const rawLine of rl) {
      // GeoJSON Text Sequence: each record may be prefixed with ASCII
      // Record Separator (0x1E) per RFC 8142 — strip it if present.
      const line = rawLine.charCodeAt(0) === 0x1e ? rawLine.slice(1) : rawLine
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const feature = JSON.parse(trimmed) as RawFeature
        if (feature.type === 'Feature') yield feature
      } catch {
        // A single malformed line shouldn't abort a multi-hour extraction —
        // osmium's own output is trusted, but this guards against a
        // truncated last line from an interrupted run.
      }
    }
  }
  return iterate()
}

function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE place (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      name_en TEXT,
      name_ru TEXT,
      brand TEXT,
      category TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      opening_hours TEXT,
      addr TEXT,
      city TEXT,
      wheelchair TEXT,
      phone TEXT,
      website TEXT,
      rank INTEGER NOT NULL
    )
  `)
  // A plain FTS5 table with an explicit rowid (matching place.id), not an
  // external-content table — this script is the only writer, so there's no
  // need for content='place' + a rebuild trigger to keep two copies in
  // sync; a direct insert alongside the place row is simpler and exactly
  // as queryable (see src/lib/places-db.ts's JOIN on f.rowid = p.id).
  db.exec(`
    CREATE VIRTUAL TABLE place_fts USING fts5(
      name, name_alt, category_terms, addr,
      tokenize="unicode61 remove_diacritics 2"
    )
  `)
}

async function main() {
  const [, , inputArg, outputArg] = process.argv
  if (!inputArg || !outputArg) {
    console.error('Usage: build-places-db.ts <input.geojsonseq> <output.db>')
    process.exit(1)
  }
  const inputPath = path.resolve(inputArg)
  const outputPath = path.resolve(outputArg)

  if (existsSync(outputPath)) unlinkSync(outputPath) // rebuilt fresh every run, never migrated in place

  const db = new DatabaseSync(outputPath)
  createSchema(db)

  const insertPlace = db.prepare(`
    INSERT INTO place (name, name_en, name_ru, brand, category, lat, lon, opening_hours, addr, city, wheelchair, phone, website, rank)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertFts = db.prepare(`INSERT INTO place_fts (rowid, name, name_alt, category_terms, addr) VALUES (?, ?, ?, ?, ?)`)

  console.log(`Reading ${inputPath}...`)
  const extracted: ExtractedPlace[] = []
  let scanned = 0
  for await (const feature of await readFeatures(inputPath)) {
    scanned++
    const place = extractPlace(feature)
    if (place) extracted.push(place)
    if (scanned % 200_000 === 0) console.log(`  scanned ${scanned}, kept ${extracted.length}`)
  }
  console.log(`Scanned ${scanned} elements, ${extracted.length} named + categorized`)

  console.log('Deduplicating...')
  const deduped = dedupe(extracted)
  console.log(`${extracted.length} -> ${deduped.length} after dedup (removed ${extracted.length - deduped.length})`)

  console.log('Writing database...')
  db.exec('BEGIN')
  let nextId = 1
  const perCategory = new Map<string, number>()
  for (const place of deduped) {
    const id = nextId++
    const nameAlt = [place.nameEn, place.nameRu, place.brand].filter(Boolean).join(' ')
    insertPlace.run(
      place.name, place.nameEn, place.nameRu, place.brand, place.category.slug,
      place.lat, place.lon, place.openingHours, place.addr, place.city, place.wheelchair,
      place.phone, place.website, rankFor(place),
    )
    insertFts.run(id, place.name, nameAlt, categoryTerms(place.category), place.addr ?? '')
    perCategory.set(place.category.slug, (perCategory.get(place.category.slug) || 0) + 1)
  }
  db.exec('COMMIT')

  db.exec('CREATE INDEX idx_place_category ON place(category)')
  db.exec('PRAGMA optimize')

  console.log('\nBy category:')
  for (const [slug, count] of Array.from(perCategory.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${slug.padEnd(20)} ${count}`)
  }
  console.log(`\nTotal rows: ${deduped.length}`)

  db.close()

  if (deduped.length < MIN_EXPECTED_ROWS) {
    console.error(`\nERROR: only ${deduped.length} rows, expected at least ${MIN_EXPECTED_ROWS} — refusing to publish a suspiciously small database.`)
    process.exit(1)
  }

  console.log(`\nWrote ${outputPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
