const CACHE_NAME = 'livetravel-shell-v1'
const SHELL_URLS = ['/', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Live data must always be fresh — never intercept API calls.
  if (url.pathname.startsWith('/api/')) return
  if (event.request.method !== 'GET') return

  if (event.request.mode === 'navigate') {
    // App shell: try the network first so updates show up immediately,
    // fall back to the cached shell only when actually offline.
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/').then((res) => res || caches.match(event.request))),
    )
    return
  }

  // Static assets (JS/CSS/icons): cache-first, refresh in the background.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((res) => {
            if (res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res.clone()))
            return res
          })
          .catch(() => cached)
        return cached || network
      }),
    )
  }
})

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Delay alert', {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || '/'))
})

// The push service can rotate a subscription's endpoint at any time
// (browser-side key rotation, not something the page triggers), firing
// this instead of a normal push event. event.oldSubscription.options
// carries the same applicationServerKey the page originally subscribed
// with, so this can re-subscribe without needing the VAPID key baked into
// the service worker at build time.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true })
      .then((subscription) =>
        fetch('/api/push/resubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            oldEndpoint: event.oldSubscription ? event.oldSubscription.endpoint : undefined,
            subscription,
          }),
        }),
      ),
  )
})
