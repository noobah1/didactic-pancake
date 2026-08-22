'use client'

import { useCallback, useEffect, useState } from 'react'
import { HomeWorkPlaces, SavedPlace } from '@/lib/types'

const STORAGE_KEY = 'homeWorkPlaces'
const CHANGE_EVENT = 'home-work-changed'

function readStored(): HomeWorkPlaces {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function useHomeWork() {
  const [places, setPlaces] = useState<HomeWorkPlaces>(readStored)

  const persist = useCallback((next: HomeWorkPlaces) => {
    setPlaces(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  useEffect(() => {
    const onChange = () => setPlaces(readStored())
    window.addEventListener(CHANGE_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const setPlace = useCallback(
    (slot: 'home' | 'work', place: SavedPlace) => {
      persist({ ...places, [slot]: place })
    },
    [places, persist],
  )

  const clearPlace = useCallback(
    (slot: 'home' | 'work') => {
      const next = { ...places }
      delete next[slot]
      persist(next)
    },
    [places, persist],
  )

  return { places, setPlace, clearPlace }
}
