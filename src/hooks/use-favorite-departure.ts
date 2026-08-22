'use client'

import { useEffect, useState } from 'react'
import { FavoriteDeparture, RouteResult, TransportMode } from '@/lib/types'
import { readCachedEntry, writeCachedEntry } from '@/lib/offline-cache'

const STORAGE_KEY = 'favoriteDepartureCache'
// Same "notify other hook instances in this tab immediately" pattern as
// use-favorites.ts's CHANGE_EVENT -- a plain 'storage' event only fires in
// *other* tabs, never the one that just cached a fresh search result.
const CHANGE_EVENT = 'favorite-departures-changed'

// Called after a successful /api/plan search whose from/to matches a saved
// favorite (see page.tsx, which owns both the search result and the
// favorites list) -- summarizes just the top itinerary's first transit leg.
export function cacheFavoriteDeparture(favoriteId: string, routes: RouteResult[]) {
  const top = routes[0]
  if (!top) return
  const transitLeg = top.legs.find((leg) => leg.mode !== 'walk')
  if (!transitLeg) return
  const departure: FavoriteDeparture = {
    mode: transitLeg.mode as TransportMode,
    line: transitLeg.route,
    startTime: top.startTime,
  }
  writeCachedEntry(STORAGE_KEY, favoriteId, departure)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useFavoriteDeparture(favoriteId: string): { departure: FavoriteDeparture; cachedAt: number } | null {
  const [entry, setEntry] = useState(() => readCachedEntry<FavoriteDeparture>(STORAGE_KEY, favoriteId))

  useEffect(() => {
    const refresh = () => setEntry(readCachedEntry<FavoriteDeparture>(STORAGE_KEY, favoriteId))
    refresh()
    window.addEventListener(CHANGE_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [favoriteId])

  return entry ? { departure: entry.data, cachedAt: entry.cachedAt } : null
}
