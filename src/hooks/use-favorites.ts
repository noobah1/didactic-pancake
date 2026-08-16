'use client'

import { useCallback, useState } from 'react'
import { FavoriteRoute } from '@/lib/types'

const STORAGE_KEY = 'favoriteRoutes'
// A "same commute" match is by rounded coordinates, not exact equality —
// re-picking the same stop from search can land a few decimal places off
// (different geocoder result ordering, a slightly different snap point),
// which would otherwise silently create a near-duplicate favorite instead
// of recognizing it as the one already saved.
const COORD_PRECISION = 4 // ~11m

function readStored(): FavoriteRoute[] {
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

function sameCommute(a: FavoriteRoute, fromLat: number, fromLng: number, toLat: number, toLng: number): boolean {
  return (
    round(a.fromLat) === round(fromLat) &&
    round(a.fromLng) === round(fromLng) &&
    round(a.toLat) === round(toLat) &&
    round(a.toLng) === round(toLng)
  )
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteRoute[]>(readStored)

  const persist = useCallback((next: FavoriteRoute[]) => {
    setFavorites(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }, [])

  const findFavorite = useCallback(
    (fromLat: number, fromLng: number, toLat: number, toLng: number) =>
      favorites.find((f) => sameCommute(f, fromLat, fromLng, toLat, toLng)) || null,
    [favorites],
  )

  const addFavorite = useCallback(
    (fromName: string, fromLat: number, fromLng: number, toName: string, toLat: number, toLng: number) => {
      if (favorites.some((f) => sameCommute(f, fromLat, fromLng, toLat, toLng))) return
      const favorite: FavoriteRoute = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromName,
        fromLat,
        fromLng,
        toName,
        toLat,
        toLng,
      }
      persist([...favorites, favorite])
    },
    [favorites, persist],
  )

  const removeFavorite = useCallback(
    (id: string) => {
      persist(favorites.filter((f) => f.id !== id))
    },
    [favorites, persist],
  )

  return { favorites, addFavorite, removeFavorite, findFavorite }
}
