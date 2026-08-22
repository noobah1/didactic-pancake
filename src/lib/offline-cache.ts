// Small localStorage-backed "last known" cache shared by anything that
// wants to keep working -- in a reduced, explicitly-stale form -- when the
// app shell loads with no network at all. public/sw.js deliberately never
// caches /api/ responses (live data must always be fresh when it CAN be
// fresh), so this is the only place that survives a cold start offline.
// Every cache is a flat id -> {data, cachedAt} map, capped so a rider who's
// opened dozens of stops/favorites over months doesn't grow it forever.

interface CacheEntry<T> {
  data: T
  cachedAt: number
}

function readAll<T>(storageKey: string): Record<string, CacheEntry<T>> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(storageKey)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeAll<T>(storageKey: string, entries: Record<string, CacheEntry<T>>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(entries))
  } catch {
    // localStorage can be unavailable (private browsing, full quota) --
    // this is a nice-to-have, never worth failing the caller's own request.
  }
}

export function readCachedEntry<T>(storageKey: string, id: string): CacheEntry<T> | null {
  return readAll<T>(storageKey)[id] ?? null
}

export function writeCachedEntry<T>(storageKey: string, id: string, data: T, maxEntries = 20) {
  const all = readAll<T>(storageKey)
  all[id] = { data, cachedAt: Date.now() }
  const ids = Object.keys(all)
  if (ids.length > maxEntries) {
    ids
      .sort((a, b) => all[a].cachedAt - all[b].cachedAt)
      .slice(0, ids.length - maxEntries)
      .forEach((staleId) => delete all[staleId])
  }
  writeAll(storageKey, all)
}
