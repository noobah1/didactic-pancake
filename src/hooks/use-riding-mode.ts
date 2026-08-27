'use client'

import { useEffect, useRef, useState } from 'react'
import { useWakeLock } from '@/hooks/use-wake-lock'
import { useTranslation } from '@/lib/i18n/context'
import { RouteLeg } from '@/lib/types'
import { ridingProgress, RidingProgress } from '@/lib/riding-progress'

// How often a fix is actually POSTed to /api/rider-report — same value as
// use-live-share.ts's own MIN_SEND_INTERVAL_MS (not imported: that constant
// isn't exported, and the two features are independent sessions that happen
// to want the same cadence, not literally sharing one).
const MIN_SEND_INTERVAL_MS = 15_000

// How long past a leg's scheduled end riding mode keeps watching before
// giving up on its own — long enough to cover ordinary lateness, short
// enough that a rider who forgot to tap "Stop" doesn't keep broadcasting
// (and holding the wake lock) for the rest of the day. Mirrors
// traveller-position.ts's JOURNEY_END_GRACE_MS for the same reason.
const LEG_END_AUTO_STOP_GRACE_MS = 30 * 60 * 1000

function randomSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Math.random().toString(36).slice(2)
}

// Best-effort get-off alarm: vibrate plus, when permission was already
// granted, a service-worker notification — needs no VAPID keys and no
// server (see public/sw.js's notificationclick handler), so it works
// whether or not the tab is focused, on Android and on an installed iOS
// PWA. Never blocks or throws; the on-screen RidingPanel carries the same
// message regardless of whether either of these actually fires.
function alertAlighting(title: string, body: string) {
  if (typeof navigator === 'undefined') return
  if ('vibrate' in navigator) navigator.vibrate([200, 100, 200])
  if (!('serviceWorker' in navigator) || typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  navigator.serviceWorker.ready
    .then((reg) => reg.showNotification(title, { body, tag: 'riding-alight' }))
    .catch(() => {})
}

// Drives one "I'm on this" session: watches the rider's own position for as
// long as `leg` is set, turns it into on-screen progress (riding-progress.ts,
// purely from position — no schedule assumptions), fires the get-off alarm
// once, and throttled-reports each fix to /api/rider-report so other riders
// on routes with no agency GPS at all (see README's "no Estonian city other
// than Tallinn" limit) get a real position instead of a timetable guess.
//
// Reactive, not imperative: the caller starts a session by passing a leg and
// stops it by passing null (or a different leg, which restarts fresh) —
// mirrors how selectedRoute/selectedRouteId already work in page.tsx, so
// there's one owner of "what's currently happening," not two. `onAutoStop`
// is how this hook hands control back when it decides to stop itself
// (permission denied, or LEG_END_AUTO_STOP_GRACE_MS past the leg's end) —
// the caller should clear whatever local state it used to pass `leg` in.
export function useRidingMode(leg: RouteLeg | null, onAutoStop: () => void) {
  const { t } = useTranslation()
  const [progress, setProgress] = useState<RidingProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const wakeLock = useWakeLock()
  const onAutoStopRef = useRef(onAutoStop)
  onAutoStopRef.current = onAutoStop

  // Keyed on tripId (not leg identity) so a fresh RouteResult object for the
  // same underlying trip — e.g. after use-route-plan.ts's own periodic
  // re-search — doesn't restart the session and lose alarmedRef's
  // once-only guard.
  const tripId = leg?.tripId

  useEffect(() => {
    if (!leg || leg.mode === 'walk' || !leg.tripId) {
      setProgress(null)
      return
    }
    if (!navigator.geolocation) {
      setError(t('location.geolocationUnsupported'))
      onAutoStopRef.current()
      return
    }

    setError(null)
    let alarmed = false
    let lastSentAt = 0
    const sessionId = randomSessionId()

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
    wakeLock.request()

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const nowMs = Date.now()
        const legEndMs = new Date(leg.endTime).getTime()
        if (nowMs > legEndMs + LEG_END_AUTO_STOP_GRACE_MS) {
          onAutoStopRef.current()
          return
        }

        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        const next = ridingProgress(leg, fix)
        setProgress(next)

        if (next.shouldAlarm && !alarmed) {
          alarmed = true
          alertAlighting(t('riding.alarmTitle'), t('riding.alarmBody', { name: next.nextStop.name }))
        }

        if (nowMs - lastSentAt < MIN_SEND_INTERVAL_MS) return
        lastSentAt = nowMs
        if (!leg.legGeometry?.points) return
        fetch('/api/rider-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tripId: leg.tripId,
            lat: fix.lat,
            lng: fix.lng,
            heading: pos.coords.heading ?? undefined,
            sessionId,
            shape: leg.legGeometry.points,
          }),
        }).catch(() => {})
      },
      (err) => {
        setError(err.code === err.PERMISSION_DENIED ? t('location.locationDenied') : t('location.locationUnavailable'))
        onAutoStopRef.current()
      },
      { enableHighAccuracy: true },
    )

    // Stops broadcasting the moment the tab actually unloads — a session
    // that's merely backgrounded (screen lock, app switch) already stops
    // producing fixes on its own within seconds (see use-wake-lock.ts's own
    // comment on why), so there's nothing more this needs to do for that
    // case specifically.
    const onPageHide = () => onAutoStopRef.current()
    window.addEventListener('pagehide', onPageHide)

    return () => {
      window.removeEventListener('pagehide', onPageHide)
      navigator.geolocation.clearWatch(watchId)
      wakeLock.release()
      setProgress(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId])

  return { progress, error }
}
