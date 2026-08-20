'use client'

import { useCallback, useEffect, useRef } from 'react'

// Holds the screen awake for as long as live location sharing is on (see
// use-live-share.ts) — without it, the phone's own screen timeout stops
// watchPosition within seconds of the screen locking, which is exactly what
// happens when it goes back in a pocket for the rest of the bus ride. Not a
// fix for background tracking (impossible for a web app — see
// use-live-share.ts's own comment), just a way to delay the moment GPS goes
// dark for as long as the sender is actually holding or has cradled the
// phone.
export function useWakeLock() {
  const lockRef = useRef<WakeLockSentinel | null>(null)
  // Tracks whether the caller wants the lock held, independent of whether
  // one is currently acquired — the spec releases the lock automatically
  // whenever the document goes hidden, so `visibilitychange` below needs to
  // know whether to re-acquire it on return, not just react to the browser's
  // own release.
  const wantedRef = useRef(false)

  const request = useCallback(async () => {
    wantedRef.current = true
    if (!('wakeLock' in navigator) || lockRef.current) return
    try {
      lockRef.current = await navigator.wakeLock.request('screen')
      lockRef.current.addEventListener('release', () => {
        lockRef.current = null
      })
    } catch {
      // Denied, unsupported, or the page isn't visible right now — sharing
      // still works via ordinary watchPosition while the screen stays on by
      // itself; this is purely an extension of that window, never required.
    }
  }, [])

  const release = useCallback(() => {
    wantedRef.current = false
    lockRef.current?.release().catch(() => {})
    lockRef.current = null
  }, [])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && wantedRef.current) {
        request()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      lockRef.current?.release().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { request, release }
}
