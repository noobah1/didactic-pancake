import fs from 'fs'
import path from 'path'
import { FavoriteRoute } from '@/lib/types'
import type { PushSubscription as WebPushSubscription } from 'web-push'

// One file on a mounted volume (see compose.yaml's didacticpancake.volumes)
// rather than a database — this app has no other persistent store, and a
// database is more than this scale needs. Without a real volume the app
// container's own filesystem is wiped on every deploy (this project
// redeploys on every push to main), so DATA_DIR must point at a mounted
// path in production; falls back to a repo-local folder for local dev
// where compose.yaml's bind mount already covers the same path.
const DATA_DIR = process.env.PUSH_DATA_DIR || path.join(process.cwd(), 'push-data')
const DATA_FILE = path.join(DATA_DIR, 'subscriptions.json')

export interface StoredSubscription {
  subscription: WebPushSubscription
  favorites: FavoriteRoute[]
  // tripId -> when we last pushed about it, so an ongoing delay doesn't
  // re-notify every single check cycle.
  lastNotifiedTripIds: Record<string, number>
  // favorite id -> the (Europe/Tallinn) date "YYYY-MM-DD" its leave-now
  // reminder last fired on, so it sends once per day rather than every
  // check cycle within the notify window.
  lastReminderDates: Record<string, string>
}

function readAll(): Record<string, StoredSubscription> {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function writeAll(data: Record<string, StoredSubscription>) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

// Keyed by the subscription's own endpoint URL — unique per browser/device,
// and it's what the browser hands back on every subscribe() call, so it
// doubles as a natural upsert key without needing our own generated id.
export function upsertSubscription(subscription: WebPushSubscription, favorites: FavoriteRoute[]) {
  const all = readAll()
  const existing = all[subscription.endpoint]
  all[subscription.endpoint] = {
    subscription,
    favorites,
    lastNotifiedTripIds: existing?.lastNotifiedTripIds || {},
    lastReminderDates: existing?.lastReminderDates || {},
  }
  writeAll(all)
}

// Chrome (or any push service) can rotate an endpoint at any time, firing
// the SW's pushsubscriptionchange rather than a fresh subscribe() call from
// the page. Re-keys the existing record onto the new endpoint so favorites
// and per-favorite state (lastNotifiedTripIds, lastReminderDates) survive
// the rotation instead of silently starting over — or over subscribing
// fresh if the old record is already gone (e.g. it was 410-removed first).
export function migrateSubscription(oldEndpoint: string | undefined, subscription: WebPushSubscription) {
  const all = readAll()
  const existing = oldEndpoint ? all[oldEndpoint] : undefined
  if (!existing) {
    upsertSubscription(subscription, [])
    return
  }
  if (oldEndpoint) delete all[oldEndpoint]
  all[subscription.endpoint] = { ...existing, subscription }
  writeAll(all)
}

export function removeSubscription(endpoint: string) {
  const all = readAll()
  if (!(endpoint in all)) return
  delete all[endpoint]
  writeAll(all)
}

export function getAllSubscriptions(): StoredSubscription[] {
  return Object.values(readAll())
}

export function markNotified(endpoint: string, tripId: string, whenMs: number) {
  const all = readAll()
  const entry = all[endpoint]
  if (!entry) return
  entry.lastNotifiedTripIds[tripId] = whenMs
  writeAll(all)
}

export function markReminderSent(endpoint: string, favoriteId: string, dateStr: string) {
  const all = readAll()
  const entry = all[endpoint]
  if (!entry) return
  // Guards a subscriptions.json written before this field existed.
  entry.lastReminderDates = { ...entry.lastReminderDates, [favoriteId]: dateStr }
  writeAll(all)
}
