import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'

// Same bind-mount-on-disk pattern as share-store.ts, so this survives a
// redeploy the same way that does — the in-process caches elsewhere in this
// app (delays, vehicles, tarktee) don't need to, but a learned traffic
// baseline takes days to rebuild from scratch (see traffic/baseline.ts), so
// it can't reset on every deploy the way those can.
const DATA_DIR = process.env.TRAFFIC_DATA_DIR || path.join(process.cwd(), 'traffic-data')

let db: DatabaseSync | null = null
let dbPath: string | null = null

// TRAFFIC_DB_PATH (":memory:" in tests) overrides the on-disk file without
// touching TRAFFIC_DATA_DIR/production behavior — see __resetDbForTests.
function resolveDbPath(): string {
  return process.env.TRAFFIC_DB_PATH || path.join(DATA_DIR, 'traffic.db')
}

function migrate(database: DatabaseSync): void {
  // Disable WAL for Windows/OneDrive compatibility — WAL causes I/O errors
  // on network filesystems and cloud storage that doesn't handle multiple
  // file handles well. Use simple DELETE journal mode with normal sync.
  database.exec('PRAGMA journal_mode = DELETE')
  database.exec('PRAGMA synchronous = NORMAL')
  // 30-second timeout for locked database — OneDrive can be slow, so give
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
  db = new DatabaseSync(resolvedPath)
  dbPath = resolvedPath
  migrate(db)
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
