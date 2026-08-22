import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDb, __resetDbForTests } from '../db'

// A real file, not ':memory:' — corruption recovery is entirely about what
// happens to a database on disk, and the in-memory path deliberately skips
// every check involved.
let dir: string
let dbFile: string

function insertSample(measuredAt: number): void {
  getDb()
    .prepare(
      'INSERT OR IGNORE INTO detector_sample (detector_id, direction, measured_at, avg_speed, flow, relative_speed) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run('D1', 'forwards', measuredAt, 80, 20, 1)
}

function sampleCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) c FROM detector_sample').get() as { c: number }
  return Number(row.c)
}

function quarantinedFiles(): string[] {
  return fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'))
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traffic-db-test-'))
  dbFile = path.join(dir, 'traffic.db')
  process.env.TRAFFIC_DB_PATH = dbFile
  __resetDbForTests()
})

afterEach(() => {
  __resetDbForTests()
  delete process.env.TRAFFIC_DB_PATH
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('getDb corruption recovery', () => {
  it('reuses an intact database instead of quarantining it', () => {
    insertSample(1_000)
    __resetDbForTests()

    expect(sampleCount()).toBe(1)
    expect(quarantinedFiles()).toHaveLength(0)
  })

  it('quarantines a cross-linked database and starts a fresh one', () => {
    // Enough rows to spread the table over many pages, so overwriting one
    // of them lands on real content rather than free space. One transaction
    // rather than 2,000 — each standalone insert is its own fsync'd commit.
    getDb().exec('BEGIN')
    for (let i = 0; i < 2_000; i++) insertSample(i * 60_000)
    getDb().exec('COMMIT')
    __resetDbForTests()

    // Same shape of damage OneDrive caused in practice: a page rewritten
    // underneath SQLite, leaving the file openable but its page tree
    // inconsistent (see defaultDataDir in db.ts).
    const handle = fs.openSync(dbFile, 'r+')
    fs.writeSync(handle, Buffer.alloc(4_096, 0xff), 0, 4_096, 4_096)
    fs.closeSync(handle)

    expect(() => sampleCount()).not.toThrow()
    expect(sampleCount()).toBe(0)
    expect(quarantinedFiles()).toHaveLength(1)
  })

  it('quarantines a file SQLite refuses to open at all', () => {
    fs.writeFileSync(dbFile, 'this is not a database')
    __resetDbForTests()

    expect(sampleCount()).toBe(0)
    expect(quarantinedFiles()).toHaveLength(1)
  })

  it('removes a stale journal alongside the quarantined database', () => {
    insertSample(1_000)
    __resetDbForTests()
    fs.writeFileSync(dbFile, 'this is not a database')
    fs.writeFileSync(`${dbFile}-journal`, 'stale journal')

    expect(sampleCount()).toBe(0)
    expect(fs.existsSync(`${dbFile}-journal`)).toBe(false)
  })
})
