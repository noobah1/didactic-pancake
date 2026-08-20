'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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
export function useLiveShare(shareId: string | null, token: string | null) {
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const lastSentRef = useRef(0)
  const shareRef = useRef({ shareId, token })
  shareRef.current = { shareId, token }

  const stop = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
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
  }, [])

  const start = useCallback(() => {
    const { shareId, token } = shareRef.current
    if (!shareId || !token) return
    if (!navigator.geolocation) {
      setError('Geolocation not supported')
      return
    }
    setError(null)
    setSharing(true)
    lastSentRef.current = 0
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now()
        if (now - lastSentRef.current < MIN_SEND_INTERVAL_MS) return
        lastSentRef.current = now
        fetch('/api/share', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: shareId,
            token,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          }),
        }).catch(() => {})
      },
      (err) => {
        setError(err.code === err.PERMISSION_DENIED ? 'Location access denied' : 'Could not get location')
        setSharing(false)
        if (watchIdRef.current != null) {
          navigator.geolocation.clearWatch(watchIdRef.current)
          watchIdRef.current = null
        }
      },
      { enableHighAccuracy: true },
    )
  }, [])

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
