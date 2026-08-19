import webpush, { WebPushError } from 'web-push'
import { getAllSubscriptions, markNotified, markReminderSent, removeSubscription, StoredSubscription } from '@/lib/push-store'
import { planTrip } from '@/lib/plan-query'
import { findVehicleForLeg, LIVE_BANNER_THRESHOLD_SEC } from '@/lib/delay'
import { computeDelays } from '@/app/api/delays/route'
import { DEFAULT_LEAD_MINUTES, shouldSendReminder, tallinnNow } from '@/lib/reminder'
import { FavoriteRoute } from '@/lib/types'

// Slower than the client's own 20s POLL_INTERVALS.delays — push doesn't
// need that latency, and every cycle here re-plans a trip through OTP for
// every favorite on every subscription, so keeping this modest matters.
const CHECK_INTERVAL_MS = 60_000
// Once notified about a given trip's delay, don't notify again for the
// same still-ongoing delay every single cycle.
const RENOTIFY_COOLDOWN_MS = 30 * 60_000

let started = false
// Guards against a slow cycle (many subscriptions x favorites, each up to
// an 8s OTP timeout) still running when the next setInterval tick fires —
// without this, two overlapping cycles could both pass a reminder's notify
// window before either had written markReminderSent, sending it twice.
let checking = false

// Called once from instrumentation.ts on server boot. Guarded so importing
// this module twice (e.g. from a route handler during dev hot-reload)
// can't start a second interval.
export function startPushChecker() {
  if (started) return
  started = true

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.warn('[push-checker] VAPID_* env vars not set — push notifications disabled')
    return
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  console.log('[push-checker] started, checking every', CHECK_INTERVAL_MS, 'ms')

  setInterval(() => {
    if (checking) {
      console.warn('[push-checker] previous cycle still running, skipping tick')
      return
    }
    console.log('[push-checker] running check cycle')
    checking = true
    runCheck()
      .catch((err) => console.error('[push-checker] check cycle failed:', err))
      .finally(() => {
        checking = false
      })
  }, CHECK_INTERVAL_MS)
}

async function runCheck() {
  const subs = getAllSubscriptions()
  if (subs.length === 0) return

  const now = tallinnNow()

  // Reminders first, and independent of the delay pass below: it's plain
  // clock arithmetic with no network involved, so a live-feed outage (OTP
  // down, GPS feed erroring) must never be able to take it down too — that
  // used to be exactly what happened when computeDelays() gated this loop.
  for (const sub of subs) {
    for (const favorite of sub.favorites) {
      try {
        await checkReminder(sub, favorite, now)
      } catch (err) {
        console.error('[push-checker] failed checking reminder', favorite.id, err)
      }
    }
  }

  let delays: Awaited<ReturnType<typeof computeDelays>>
  try {
    delays = await computeDelays()
  } catch (err) {
    console.error('[push-checker] computeDelays failed, skipping delay pass this cycle:', err)
    return
  }

  const nowMs = Date.now()
  for (const sub of subs) {
    for (const favorite of sub.favorites) {
      try {
        await checkFavorite(sub, favorite, delays.vehicles, nowMs)
      } catch (err) {
        console.error('[push-checker] failed checking favorite', favorite.id, err)
      }
    }
  }
}

async function checkReminder(sub: StoredSubscription, favorite: FavoriteRoute, now: ReturnType<typeof tallinnNow>) {
  if (!shouldSendReminder(favorite, now, sub.lastReminderDates?.[favorite.id])) return

  const leadMinutes = favorite.reminderLeadMinutes ?? DEFAULT_LEAD_MINUTES
  const payload = JSON.stringify({
    title: `Leave in ${leadMinutes} min`,
    body: `Time to head out for your ${favorite.fromName} → ${favorite.toName} trip`,
    url: '/',
  })
  const sent = await sendPush(sub, payload)
  if (sent) markReminderSent(sub.subscription.endpoint, favorite.id, now.dateStr)
}

async function checkFavorite(
  sub: StoredSubscription,
  favorite: FavoriteRoute,
  liveVehicles: Awaited<ReturnType<typeof computeDelays>>['vehicles'],
  nowMs: number,
) {
  const plan = await planTrip(favorite.fromLat, favorite.fromLng, favorite.toLat, favorite.toLng)
  const bestRoute = plan.routes?.[0]
  if (!bestRoute) return

  for (const leg of bestRoute.legs) {
    if (leg.mode === 'walk' || !leg.tripId) continue

    // Exact tripId match first, same pattern RouteCard's own delay badge
    // and page.tsx's journeyVehicles use — the position/heading fallback
    // is for when OTP's planned trip and the live GPS matcher's pick
    // genuinely diverge, not the common case.
    const exact = liveVehicles.find((v) => v.tripId === leg.tripId)
    const match = exact ?? findVehicleForLeg(leg, liveVehicles, nowMs)
    console.log('[push-checker] leg', leg.mode, leg.route, leg.tripId, 'match:', match ? `${match.delaySeconds}s` : 'none')
    if (!match || match.delaySeconds < LIVE_BANNER_THRESHOLD_SEC) continue

    const lastNotified = sub.lastNotifiedTripIds[leg.tripId]
    if (lastNotified && nowMs - lastNotified < RENOTIFY_COOLDOWN_MS) continue

    const sent = await sendDelayPush(sub, favorite, leg, match.delaySeconds)
    if (sent) markNotified(sub.subscription.endpoint, leg.tripId, nowMs)
  }
}

async function sendDelayPush(
  sub: StoredSubscription,
  favorite: FavoriteRoute,
  leg: { route?: string; mode: string },
  delaySeconds: number,
): Promise<boolean> {
  const minutes = Math.round(delaySeconds / 60)
  const payload = JSON.stringify({
    title: `${leg.route || leg.mode} is running ${minutes} min late`,
    body: `On your ${favorite.fromName} → ${favorite.toName} route`,
    url: '/',
  })
  return sendPush(sub, payload)
}

async function sendPush(sub: StoredSubscription, payload: string): Promise<boolean> {
  try {
    await webpush.sendNotification(sub.subscription, payload)
    return true
  } catch (err) {
    if (err instanceof WebPushError && err.statusCode === 410) {
      // Standard web-push signal that the subscription is gone (browser
      // uninstalled, permission revoked, etc.) — stop trying it.
      removeSubscription(sub.subscription.endpoint)
    } else {
      console.error('[push-checker] sendNotification failed:', err)
    }
    return false
  }
}
