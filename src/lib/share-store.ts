import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { RouteResult, SharePosition } from '@/lib/types'

// One JSON file per share, not push-store's single dictionary file — shares
// are created far more often than push subscriptions and, unlike a
// subscription, are never rewritten after creation, so there's no reason to
// read-modify-write one shared file for every link someone generates.
const DATA_DIR = process.env.SHARE_DATA_DIR || path.join(process.cwd(), 'share-data')
// A shared journey is a snapshot of a specific plan, useful for as long as
// the trip it describes is still relevant — long enough to forward and
// still open days later, short enough that disk usage doesn't grow forever.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
// A live position is a much more sensitive payload than the static route
// snapshot it rides along with — bounded far tighter so a forgotten "share
// my location" toggle can't leave someone's whereabouts readable by anyone
// still holding the link for the full 30 days above. Long enough to cover a
// journey with real delays, short enough that "stop sharing" isn't the only
// thing standing between a stale link and a live-looking position.
const LIVE_POSITION_MAX_AGE_MS = 3 * 60 * 60 * 1000
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{6,16}$/

interface StoredShare {
  route: RouteResult
  createdAt: number
  // Hashed, never the raw token — see createShare. A leaked share-data file
  // (backup, misconfigured static host) shouldn't hand out write access to
  // every position ever broadcast on it.
  ownerTokenHash: string
  position?: SharePosition
  // Whether the owner currently has live sharing switched on — distinct from
  // `position` existing: a viewer's inferred-from-vehicle tiers (see
  // traveller-position.ts) are only ever allowed to run for a share whose
  // owner actually opted in, not for anyone who merely still has a `position`
  // left over from before they turned it off (clearSharePosition wipes both
  // together, but this flag is what a consumer must gate inference on, since
  // a present-but-stale `position` alone doesn't prove consent is current).
  sharing: boolean
}

function filePath(id: string): string {
  return path.join(DATA_DIR, `${id}.json`)
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function readStored(id: string): StoredShare | null {
  if (!SHARE_ID_PATTERN.test(id)) return null
  try {
    const raw = fs.readFileSync(filePath(id), 'utf8')
    return JSON.parse(raw) as StoredShare
  } catch {
    return null
  }
}

function writeStored(id: string, stored: StoredShare) {
  fs.writeFileSync(filePath(id), JSON.stringify(stored))
}

export function createShare(route: RouteResult): { id: string; token: string } {
  const id = crypto.randomBytes(6).toString('base64url')
  const token = crypto.randomBytes(24).toString('base64url')
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const stored: StoredShare = { route, createdAt: Date.now(), ownerTokenHash: hashToken(token), sharing: false }
  writeStored(id, stored)
  return { id, token }
}

export function getShare(
  id: string,
): { route: RouteResult; position: SharePosition | null; sharing: boolean } | null {
  const stored = readStored(id)
  if (!stored) return null
  if (Date.now() - stored.createdAt > MAX_AGE_MS) {
    try {
      fs.unlinkSync(filePath(id))
    } catch {
      // Already gone — fine, that's the end state we wanted anyway.
    }
    return null
  }
  const fresh = !!stored.position && Date.now() - stored.position.updatedAt <= LIVE_POSITION_MAX_AGE_MS
  // A dead phone (battery, crash, force-quit before the sender could toggle
  // off) must not leave `sharing: true` readable forever — bounding it to
  // the same freshness window as the position itself means a consumer never
  // needs a separate cleanup job to notice the owner is effectively gone.
  return { route: stored.route, position: fresh ? stored.position! : null, sharing: stored.sharing && fresh }
}

// Returns false (and writes nothing) on a bad id or a token that doesn't
// match the share's owner — the caller can't tell which, deliberately: a
// distinguishing error would let someone probe for valid share ids.
export function updateSharePosition(id: string, token: string, lat: number, lng: number): boolean {
  const stored = readStored(id)
  if (!stored || stored.ownerTokenHash !== hashToken(token)) return false
  if (Date.now() - stored.createdAt > MAX_AGE_MS) return false
  stored.position = { lat, lng, updatedAt: Date.now() }
  stored.sharing = true
  writeStored(id, stored)
  return true
}

export function clearSharePosition(id: string, token: string): boolean {
  const stored = readStored(id)
  if (!stored || stored.ownerTokenHash !== hashToken(token)) return false
  delete stored.position
  stored.sharing = false
  writeStored(id, stored)
  return true
}
