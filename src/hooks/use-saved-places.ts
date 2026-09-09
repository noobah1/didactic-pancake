'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Place,
  SavedPlace,
  RecentSearch,
  getSavedPlaces,
  savePlace,
  removeSavedPlace,
  getRecentSearches,
  addRecentSearch,
} from '@/lib/storage'

export function useSavedPlaces() {
  const [saved, setSaved] = useState<SavedPlace[]>([])
  const [recents, setRecents] = useState<RecentSearch[]>([])

  // Hydrate after mount — reading storage during render breaks SSR
  useEffect(() => {
    setSaved(getSavedPlaces())
    setRecents(getRecentSearches())
  }, [])

  const save = useCallback((place: Place, kind?: SavedPlace['kind']) => {
    setSaved(savePlace(place, kind))
  }, [])

  const remove = useCallback((id: string) => {
    setSaved(removeSavedPlace(id))
  }, [])

  const recordSearch = useCallback((from: Place, to: Place) => {
    setRecents(addRecentSearch(from, to))
  }, [])

  return { saved, recents, save, remove, recordSearch }
}
