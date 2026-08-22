'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useWakeLock } from '@/hooks/use-wake-lock'
import { useTranslation } from '@/lib/i18n/context'

// How often a new watchPosition fix is actually sent to the server —
// watchPosition itself can fire far more often than that (every couple of
// seconds with enableHighAccuracy), which would be both wasteful and far
// more precise a trail than "where roughly is my friend right now" needs.
const MIN_SEND_INTERVAL_MS = 15_000

// Broadcasts the current user's own position onto a share they just created
// (see RouteResults' Share button and /api/share's PATCH), for as long as
// they leave it switched on. Mirrors use-geolocation.ts's permission-denied
// phrasing so this reads as the same feature, not a second location prompt
// with different wording.
//
// Holds a screen wake lock (use-wake-lock.ts) the whole time sharing is on —
// watchPosition itself stops firing within seconds of the screen locking, so
// without this the feature would die the moment the sender's phone goes back
// in a pocket. That's still not real background tracking (impossible for a
// web app), just a way to delay when GPS goes dark for as long as the phone
// is actually being held. When it does go dark anyway (lock overridden by
// the OS, tab backgrounded on a platform that ignores the lock), the viewer
// falls back to inferring a position from the vehicle/timetable — see
// traveller-position.ts — using whatever this hook's last real fix was.
export function useLiveShare(shareId: string | null, token: string | null) {
  const { t } = useTranslation()
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const lastSentRef = useRef(0)
  const sharingRef = useRef(false)
  // The most recent fix regardless of the send throttle above — used to
  // flush one last, un-throttled PATCH the moment the page hides, so the
  // viewer's "last seen" position is as fresh as possible right before GPS
  // goes dark, not up to MIN_SEND_INTERVAL_MS stale.
  const latestFixRef = useRef<{ lat: number; lng: number } | null>(null)
  const shareRef = useRef({ shareId, token })
  shareRef.current = { shareId, token }
  const wakeLock = useWakeLock()

  const sendPosition = useCallback((lat: number, lng: number, opts?: { keepalive?: boolean }) => {
    const { shareId, token } = shareRef.current
    if (!shareId || !token) return
    fetch('/api/share', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: shareId, token, lat, lng }),
      keepalive: opts?.keepalive,
    }).catch(() => {})
  }, [])

  const stop = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    sharingRef.current = false
    wakeLock.release()
    setSharing(false)
    const { shareId, token } = shareRef.current
    if (shareId && token) {
      // Best-effort: the tab may be closing, so keepalive lets this survive
      // unload instead of getting cancelled with the rest of the page.
      fetch('/api/share', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: shareId, token }),
        keepalive: true,
      }).catch(() => {})
    }
  }, [wakeLock])

  const start = useCallback(() => {
    const { shareId, token } = shareRef.current
    if (!shareId || !token) return
    if (!navigator.geolocation) {
      setError(t('location.geolocationUnsupported'))
      return
    }
    setError(null)
    setSharing(true)
    sharingRef.current = true
    lastSentRef.current = 0
    latestFixRef.current = null
    wakeLock.request()
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        latestFixRef.current = { lat, lng }
        const now = Date.now()
        if (now - lastSentRef.current < MIN_SEND_INTERVAL_MS) return
        lastSentRef.current = now
        sendPosition(lat, lng)
      },
      (err) => {
        setError(err.code === err.PERMISSION_DENIED ? t('location.locationDenied') : t('location.locationUnavailable'))
        setSharing(false)
        sharingRef.current = false
        wakeLock.release()
        if (watchIdRef.current != null) {
          navigator.geolocation.clearWatch(watchIdRef.current)
          watchIdRef.current = null
        }
      },
      { enableHighAccuracy: true },
    )
  }, [sendPosition, wakeLock, t])

  // The moment the page hides — screen lock, app switch, tab backgrounded —
  // is exactly when watchPosition is about to stop firing, so this is the
  // last reliable chance to report an accurate position before the marker
  // has to fall back to inference. `pagehide` covers an actual unload/close;
  // `visibilitychange` covers everything short of that (screen lock, app
  // switch) which `pagehide` doesn't fire for on its own.
  useEffect(() => {
    const flush = () => {
      if (!sharingRef.current) return
      const fix = latestFixRef.current
      if (!fix) return
      sendPosition(fix.lat, fix.lng, { keepalive: true })
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
    }
  }, [sendPosition])

  // Stop broadcasting (and best-effort clear the last position) if the
  // component unmounts while still sharing — a closed tab shouldn't leave a
  // "live" marker frozen on someone else's map indefinitely.
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { sharing, error, start, stop }
}
