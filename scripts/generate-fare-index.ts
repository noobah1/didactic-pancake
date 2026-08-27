/**
 * Regenerates src/lib/fares/gtfs-index.json — the static route→authority,
 * stop→zone and agency→ticket-shop lookup behind src/lib/fares/price.ts.
 *
 * Why this exists: OTP's own GraphQL API exposes a leg's `route { gtfsId
 * shortName }` and `stop { gtfsId }`, but not the two non-standard GTFS
 * columns Estonia's fare model actually runs on — `routes.txt`'s
 * `competent_authority` (which tariff table applies) and `stops.txt`'s
 * `zone_id` (which zone-ladder rung applies, for the few authorities that
 * are zoned rather than flat-fare). Those columns exist only in the raw GTFS
 * zips OTP is built from, not in anything OTP serves back — this script is
 * what turns them into a lookup the running app can actually use, without
 * shipping the underlying ~50MB feed to the client or re-parsing it on every
 * request.
 *
 * Deliberately generated, never hand-written, and re-runnable: authority and
 * zone assignments shift whenever the national GTFS feed is rebuilt (see
 * .github/workflows/build-otp-graph.yml), and a route silently left mapped to
 * a stale authority would quote the wrong price with no warning.
 *
 * Run from the repo root, against the committed zips (no OTP server needed —
 * this reads the GTFS zips directly, not the graph):
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/generate-fare-index.ts
 *
 * Prints a per-feed summary so a bad run (e.g. the upstream publisher
 * dropping or renaming competent_authority) is obvious before it's committed
 * — compare against the counts in docs/plans or the last commit's output
 * rather than assuming a silent structural change is fine.
 */
import { execFileSync } from 'child_process'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import path from 'path'

// (zip file, OTP feed-id prefix) — order and prefixes match how build-config.json's
// transitFeeds are declared and how OTP assigns feed ids from that order (confirmed
// live against the graph: see TALLINN_TRANSPORT_AGENCY_GTFS_ID / ELRON_AGENCY_GTFS_ID
// in src/lib/constants.ts, prefixes "1:" and "2:"). tslaevad.zip is the third feed
// declared, so "3:".
const FEEDS: { file: string; prefix: string }[] = [
  { file: 'estonia_unified_gtfs.zip', prefix: '1:' },
  { file: 'elron.zip', prefix: '2:' },
  { file: 'tslaevad.zip', prefix: '3:' },
]

const OTP_DATA_DIR = path.join(__dirname, '..', 'otp', 'data')
const OUT_PATH = path.join(__dirname, '..', 'src', 'lib', 'fares', 'gtfs-index.json')
const ETAG_PATH = path.join(__dirname, '..', 'otp', '.gtfs-etag')

interface Table {
  header: string[]
  rows: string[][]
}

// Minimal RFC4180-style CSV parser — GTFS text fields (route_desc especially)
// contain embedded commas and HTML inside double quotes, so a plain split(',')
// silently misaligns columns on exactly the rows most likely to matter.
function parseCsv(text: string): Table {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  // Normalize line endings up front so \r\n from the source doesn't leak a
  // trailing \r into the last field of every row.
  const s = text.replace(/\r\n/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  const header = rows.shift() || []
  // GTFS files sometimes end with a trailing blank line — drop rows that are
  // just a single empty field rather than treating them as real data.
  return { header, rows: rows.filter((r) => !(r.length === 1 && r[0] === '')) }
}

function readCsvFromZip(zipPath: string, entry: string): Table | null {
  try {
    const buf = execFileSync('unzip', ['-p', zipPath, entry], { maxBuffer: 1024 * 1024 * 64 })
    return parseCsv(buf.toString('utf-8'))
  } catch {
    // Not every feed carries every file (elron.zip and tslaevad.zip have no
    // fare_attributes.txt) — absence here just means this feed contributes
    // nothing to that particular index, not that the run failed.
    return null
  }
}

function col(table: Table, name: string): number {
  return table.header.indexOf(name)
}

// stops.txt's zone_id is inconsistently cased across operators (tartu1 vs
// TartuLinn vs Tartu) and a handful of rows join multiple zones with a comma
// (e.g. "PärnuLinn,PärnuMVLL") — normalized here so the fare engine can do
// exact-string zone lookups without repeating this cleanup at request time.
function normalizeZones(raw: string): string[] {
  return raw
    .split(',')
    .map((z) => z.trim().toLowerCase())
    .filter((z) => z.length > 0)
}

function main() {
  const authorities: string[] = []
  const authorityIndex = new Map<string, number>()
  function authorityId(name: string): number {
    let idx = authorityIndex.get(name)
    if (idx === undefined) {
      idx = authorities.length
      authorities.push(name)
      authorityIndex.set(name, idx)
    }
    return idx
  }

  const routeAuthority: Record<string, number> = {}
  // route gtfsId → agency gtfsId, so a leg can resolve its own operator's
  // fare_url (via agencyFareUrl below) without OTP's PLAN_QUERY needing to
  // request `route { agency { gtfsId } }` — routes.txt already carries
  // agency_id directly, one file read instead of a GraphQL query change.
  const routeAgency: Record<string, string> = {}
  const stopZone: Record<string, string[]> = {}
  const agencyFareUrl: Record<string, string> = {}

  console.log('Generating fare index from committed GTFS feeds...\n')

  for (const feed of FEEDS) {
    const zipPath = path.join(OTP_DATA_DIR, feed.file)
    if (!existsSync(zipPath)) {
      console.log(`${feed.file.padEnd(28)} MISSING — skipped`)
      continue
    }

    let routeCount = 0
    let blankAuthorityCount = 0
    const seenAuthorities = new Set<string>()
    const routes = readCsvFromZip(zipPath, 'routes.txt')
    if (routes) {
      const idCol = col(routes, 'route_id')
      const authCol = col(routes, 'competent_authority')
      const agencyCol = col(routes, 'agency_id')
      if (idCol === -1) {
        console.log(`${feed.file.padEnd(28)} routes.txt has no route_id column — skipped`)
      } else {
        for (const row of routes.rows) {
          const routeId = row[idCol]
          if (!routeId) continue
          if (agencyCol !== -1 && row[agencyCol]) {
            routeAgency[feed.prefix + routeId] = feed.prefix + row[agencyCol]
          }
          if (authCol === -1) continue
          const authorityRaw = (row[authCol] || '').trim()
          if (!authorityRaw) {
            blankAuthorityCount++
            continue
          }
          routeAuthority[feed.prefix + routeId] = authorityId(authorityRaw)
          seenAuthorities.add(authorityRaw)
          routeCount++
        }
        if (authCol === -1) console.log(`${feed.file.padEnd(28)} routes.txt has no competent_authority column`)
      }
    }

    let stopCount = 0
    const stops = readCsvFromZip(zipPath, 'stops.txt')
    if (stops) {
      const idCol = col(stops, 'stop_id')
      const zoneCol = col(stops, 'zone_id')
      if (idCol !== -1 && zoneCol !== -1) {
        for (const row of stops.rows) {
          const stopId = row[idCol]
          const zoneRaw = (row[zoneCol] || '').trim()
          if (!stopId || !zoneRaw) continue
          stopZone[feed.prefix + stopId] = normalizeZones(zoneRaw)
          stopCount++
        }
      }
    }

    let agencyCount = 0
    const agency = readCsvFromZip(zipPath, 'agency.txt')
    if (agency) {
      const idCol = col(agency, 'agency_id')
      const urlCol = col(agency, 'agency_fare_url')
      if (idCol !== -1 && urlCol !== -1) {
        for (const row of agency.rows) {
          const agencyId = row[idCol]
          const url = (row[urlCol] || '').trim()
          if (!agencyId || !url) continue
          agencyFareUrl[feed.prefix + agencyId] = url
          agencyCount++
        }
      }
    }

    console.log(
      `${feed.file.padEnd(28)} ${String(routeCount).padStart(4)} routes → ` +
        `${seenAuthorities.size} authorities (${blankAuthorityCount} blank), ` +
        `${String(stopCount).padStart(5)} zoned stops, ${agencyCount} agency fare URLs`,
    )
  }

  const feedVersion = existsSync(ETAG_PATH) ? readFileSync(ETAG_PATH, 'utf-8').trim() : null

  const output = {
    generatedAt: new Date().toISOString().slice(0, 10),
    feedVersion,
    authorities,
    routeAuthority,
    routeAgency,
    stopZone,
    agencyFareUrl,
  }

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n')

  console.log(`\nWrote ${OUT_PATH}`)
  console.log(
    `${authorities.length} authorities, ${Object.keys(routeAuthority).length} routes, ` +
      `${Object.keys(stopZone).length} zoned stops, ${Object.keys(agencyFareUrl).length} agency fare URLs`,
  )
  console.log(`Authorities: ${authorities.join(', ')}`)
}

main()
