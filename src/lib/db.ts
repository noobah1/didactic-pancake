import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'

// Same bind-mount-on-disk pattern as share-store.ts, so this survives a
// redeploy the same way that does — the in-process caches elsewhere in this
// app (delays, vehicles, tarktee) don't need to, but a learned traffic
// baseline takes days to rebuild from scratch (see traffic/baseline.ts), so
// it can't reset on every deploy the way those can.
const DATA_DIR = process.env.TRAFFIC_DATA_DIR || defaultDataDir()

let db: DatabaseSync | null = null
let dbPath: string | null = null

// Production sets TRAFFIC_DATA_DIR to a bind-mounted volume (see
// compose.yaml), so this fallback only ever decides where a local dev
// database lives.
//
// A cloud-synced folder is the one place a SQLite file must never live: the
// sync client rewrites the file underneath the open handle, which
// cross-links pages and corrupts the database beyond what any journal mode
// can prevent. This repo's own traffic.db died exactly that way — it sits
// in a OneDrive tree, and `PRAGMA quick_check` reported four cross-linked
// pages ("2nd reference to page N") plus a broken detector_baseline index,
// which is what got the sampler switched off in instrumentation.ts. Keeping
// the file under LOCALAPPDATA puts it outside the synced tree, which is
// also where Windows expects an app's own working data to go.
function defaultDataDir(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'livetravel', 'traffic-data')
  }
  return path.join(process.cwd(), 'traffic-data')
}

// TRAFFIC_DB_PATH (":memory:" in tests) overrides the on-disk file without
// touching TRAFFIC_DATA_DIR/production behavior — see __resetDbForTests.
function resolveDbPath(): string {
  return process.env.TRAFFIC_DB_PATH || path.join(DATA_DIR, 'traffic.db')
}

// SQLite reports corruption only when a read actually reaches a damaged
// page, so opening a long-dead database still succeeds and the failure
// surfaces much later as a thrown query deep inside getBaselines() — where
// there is nothing sensible left to do about it. Checking at open time is
// what makes recovery possible at all. quick_check skips the (much slower)
// per-row index verification full integrity_check does, and this runs once
// per process boot, not per query.
function isIntact(database: DatabaseSync): boolean {
  try {
    const rows = database.prepare('PRAGMA quick_check(1)').all() as { quick_check: string }[]
    return rows.length === 1 && rows[0].quick_check === 'ok'
  } catch {
    return false
  }
}

// Renamed rather than deleted: a corrupt baseline database is still days of
// samples that a later salvage pass can mostly read (only the pages that
// are actually cross-linked throw), and silently destroying that history
// would be a worse failure than the corruption itself.
function quarantine(corruptPath: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = `${corruptPath}.corrupt-${stamp}`
  try {
    fs.renameSync(corruptPath, target)
    console.error(`[traffic-db] corrupt database moved to ${target}; starting a fresh one`)
  } catch (error) {
    // Nothing recoverable left to protect at this point — a database that
    // can neither be read nor moved aside would otherwise block sampling
    // forever, which is the one outcome worse than losing the history.
    console.error('[traffic-db] corrupt database could not be moved aside, deleting:', error)
    fs.rmSync(corruptPath, { force: true })
  }
  // A journal left behind by the dead database describes pages that no
  // longer exist; SQLite would try to replay it into the fresh file.
  fs.rmSync(`${corruptPath}-journal`, { force: true })
}

function open(resolvedPath: string): DatabaseSync {
  if (resolvedPath === ':memory:') {
    const fresh = new DatabaseSync(resolvedPath)
    migrate(fresh)
    return fresh
  }

  try {
    const existing = new DatabaseSync(resolvedPath)
    if (isIntact(existing)) {
      migrate(existing)
      return existing
    }
    existing.close()
  } catch (error) {
    // Damage bad enough that SQLite rejects the file outright ("file is not
    // a database" — a truncated or half-synced write) throws here and never
    // reaches quick_check, but it needs exactly the same recovery.
    console.error('[traffic-db] database could not be opened:', error)
  }

  quarantine(resolvedPath)
  const replacement = new DatabaseSync(resolvedPath)
  migrate(replacement)
  return replacement
}

function migrate(database: DatabaseSync): void {
  // DELETE rather than WAL: WAL keeps a second file that readers and
  // writers must agree on, which network filesystems and cloud-storage
  // clients handle poorly. This does not by itself make a synced folder
  // safe (see defaultDataDir — nothing does), it just avoids adding a
  // second file to the problem.
  database.exec('PRAGMA journal_mode = DELETE')
  database.exec('PRAGMA synchronous = NORMAL')
  // 30-second timeout for locked database — a slow filesystem should get
  // retries a chance to succeed rather than instant failure
  database.exec('PRAGMA busy_timeout = 30000')
  // Increase cache size to reduce disk I/O
  database.exec('PRAGMA cache_size = -10000')
  database.exec(`
    CREATE TABLE IF NOT EXISTS detector_sample (
      detector_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      measured_at INTEGER NOT NULL,
      avg_speed REAL NOT NULL,
      flow INTEGER,
      relative_speed INTEGER,
      PRIMARY KEY (detector_id, direction, measured_at)
    )
  `)
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_detector_sample_measured_at
      ON detector_sample(measured_at)
  `)
  database.exec(`
    CREATE TABLE IF NOT EXISTS detector_baseline (
      detector_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      free_flow_kmh REAL NOT NULL,
      sample_count INTEGER NOT NULL,
      computed_at INTEGER NOT NULL,
      PRIMARY KEY (detector_id, direction)
    )
  `)
}

export function getDb(): DatabaseSync {
  const resolvedPath = resolveDbPath()
  if (db && dbPath === resolvedPath) return db

  db?.close()
  if (resolvedPath !== ':memory:') fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
  db = open(resolvedPath)
  dbPath = resolvedPath
  return db
}

// Test-only: force the next getDb() to open a fresh handle even if
// TRAFFIC_DB_PATH hasn't changed (":memory:" reused across tests would
// otherwise keep returning the same cached in-memory database).
export function __resetDbForTests(): void {
  db?.close()
  db = null
  dbPath = null
}
