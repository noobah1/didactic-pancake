'use client'

import { useCallback, useEffect, useState } from 'react'
import { FavoriteRoute } from '@/lib/types'

const STORAGE_KEY = 'pushNotificationsEnabled'
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

// PushManager.subscribe wants the VAPID key as a raw Uint8Array, not the
// base64url string it's distributed as.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
}

async function getSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

async function postSubscription(subscription: PushSubscription, favorites: FavoriteRoute[]) {
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription, favorites }),
  })
}

export function usePushNotifications() {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setEnabled(localStorage.getItem(STORAGE_KEY) === 'true')
  }, [])

  const enable = useCallback(async () => {
    if (!isPushSupported() || !VAPID_PUBLIC_KEY) return false
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return false

      const registration = await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        }))

      const favorites: FavoriteRoute[] = JSON.parse(localStorage.getItem('favoriteRoutes') || '[]')
      await postSubscription(subscription, favorites)

      localStorage.setItem(STORAGE_KEY, 'true')
      setEnabled(true)
      return true
    } finally {
      setBusy(false)
    }
  }, [])

  const disable = useCallback(async () => {
    setBusy(true)
    try {
      const subscription = await getSubscription()
      if (subscription) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        await subscription.unsubscribe()
      }
      localStorage.setItem(STORAGE_KEY, 'false')
      setEnabled(false)
    } finally {
      setBusy(false)
    }
  }, [])

  // Keep the server's copy of favorites current while notifications are on,
  // so a favorite added/removed after subscribing still gets checked (or
  // stops being checked) without the rider having to re-toggle the switch.
  useEffect(() => {
    if (!enabled) return

    const resync = async () => {
      const subscription = await getSubscription()
      if (!subscription) return
      const favorites: FavoriteRoute[] = JSON.parse(localStorage.getItem('favoriteRoutes') || '[]')
      await postSubscription(subscription, favorites)
    }

    window.addEventListener('favorites-changed', resync)
    return () => window.removeEventListener('favorites-changed', resync)
  }, [enabled])

  return { enabled, busy, enable, disable, supported: isPushSupported() }
}
