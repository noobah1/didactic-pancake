import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { RouteResult } from '@/lib/types'

// One JSON file per share, not push-store's single dictionary file — shares
// are created far more often than push subscriptions and, unlike a
// subscription, are never rewritten after creation, so there's no reason to
// read-modify-write one shared file for every link someone generates.
const DATA_DIR = process.env.SHARE_DATA_DIR || path.join(process.cwd(), 'share-data')
// A shared journey is a snapshot of a specific plan, useful for as long as
// the trip it describes is still relevant — long enough to forward and
// still open days later, short enough that disk usage doesn't grow forever.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{6,16}$/

interface StoredShare {
  route: RouteResult
  createdAt: number
}

function filePath(id: string): string {
  return path.join(DATA_DIR, `${id}.json`)
}

export function createShare(route: RouteResult): string {
  const id = crypto.randomBytes(6).toString('base64url')
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const stored: StoredShare = { route, createdAt: Date.now() }
  fs.writeFileSync(filePath(id), JSON.stringify(stored))
  return id
}

export function getShare(id: string): RouteResult | null {
  if (!SHARE_ID_PATTERN.test(id)) return null
  try {
    const raw = fs.readFileSync(filePath(id), 'utf8')
    const stored: StoredShare = JSON.parse(raw)
    if (Date.now() - stored.createdAt > MAX_AGE_MS) {
      fs.unlinkSync(filePath(id))
      return null
    }
    return stored.route
  } catch {
    return null
  }
}
