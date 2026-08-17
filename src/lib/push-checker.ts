import webpush, { WebPushError } from 'web-push'
import { getAllSubscriptions, markNotified, removeSubscription, StoredSubscription } from '@/lib/push-store'
import { planTrip } from '@/lib/plan-query'
import { findVehicleForLeg, LIVE_BANNER_THRESHOLD_SEC } from '@/lib/delay'
import { computeDelays } from '@/app/api/delays/route'
import { FavoriteRoute } from '@/lib/types'

// Slower than the client's own 20s POLL_INTERVALS.delays — push doesn't
// need that latency, and every cycle here re-plans a trip through OTP for
// every favorite on every subscription, so keeping this modest matters.
const CHECK_INTERVAL_MS = 60_000
// Once notified about a given trip's delay, don't notify again for the
// same still-ongoing delay every single cycle.
const RENOTIFY_COOLDOWN_MS = 30 * 60_000

let started = false

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
    console.log('[push-checker] running check cycle')
    runCheck().catch((err) => console.error('[push-checker] check cycle failed:', err))
  }, CHECK_INTERVAL_MS)
}

async function runCheck() {
  const subs = getAllSubscriptions()
  if (subs.length === 0) return

  const delays = await computeDelays()
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
