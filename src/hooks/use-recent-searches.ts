'use client'

import { useCallback, useEffect, useState } from 'react'
import { RecentSearch } from '@/lib/types'

const STORAGE_KEY = 'recentSearches'
// Same "notify other useRecentSearches() instances in this tab" pattern as
// use-favorites.ts's CHANGE_EVENT.
const CHANGE_EVENT = 'recent-searches-changed'
const MAX_RECENTS = 5
const COORD_PRECISION = 4 // ~11m, same tolerance as use-favorites.ts

function readStored(): RecentSearch[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function round(n: number): number {
  return Math.round(n * 10 ** COORD_PRECISION) / 10 ** COORD_PRECISION
}

function sameTrip(a: RecentSearch, fromLat: number, fromLng: number, toLat: number, toLng: number): boolean {
  return (
    round(a.fromLat) === round(fromLat) &&
    round(a.fromLng) === round(fromLng) &&
    round(a.toLat) === round(toLat) &&
    round(a.toLng) === round(toLng)
  )
}

export function useRecentSearches() {
  const [recents, setRecents] = useState<RecentSearch[]>(readStored)

  const persist = useCallback((next: RecentSearch[]) => {
    setRecents(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  useEffect(() => {
    const onChange = () => setRecents(readStored())
    window.addEventListener(CHANGE_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  // Re-searching a trip already at the top is a no-op re-sort, not a new
  // entry — de-dupe by coordinates before prepending, same as a favorite.
  const logSearch = useCallback(
    (fromName: string, fromLat: number, fromLng: number, toName: string, toLat: number, toLng: number) => {
      const withoutDupe = recents.filter((r) => !sameTrip(r, fromLat, fromLng, toLat, toLng))
      const entry: RecentSearch = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromName,
        fromLat,
        fromLng,
        toName,
        toLat,
        toLng,
        searchedAt: Date.now(),
      }
      persist([entry, ...withoutDupe].slice(0, MAX_RECENTS))
    },
    [recents, persist],
  )

  const removeRecent = useCallback(
    (id: string) => {
      persist(recents.filter((r) => r.id !== id))
    },
    [recents, persist],
  )

  return { recents, logSearch, removeRecent }
}
