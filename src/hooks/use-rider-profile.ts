'use client'

import { useCallback, useEffect, useState } from 'react'
import { RiderProfile } from '@/lib/fares/tariffs'

const STORAGE_KEY = 'riderProfile'
const CHANGE_EVENT = 'rider-profile-changed'
const DEFAULT_PROFILE: RiderProfile = { ageBand: 'adult' }

function readStored(): RiderProfile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULT_PROFILE, ...JSON.parse(raw) } : DEFAULT_PROFILE
  } catch {
    return DEFAULT_PROFILE
  }
}

export function useRiderProfile() {
  const [profile, setProfile] = useState<RiderProfile>(readStored)

  const persist = useCallback((next: RiderProfile) => {
    setProfile(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  useEffect(() => {
    const onChange = () => setProfile(readStored())
    window.addEventListener(CHANGE_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const setAgeBand = useCallback(
    (ageBand: RiderProfile['ageBand']) => persist({ ...profile, ageBand }),
    [profile, persist],
  )

  const setResidentOf = useCallback(
    (residentOf: string | undefined) => persist({ ...profile, residentOf }),
    [profile, persist],
  )

  return { profile, setAgeBand, setResidentOf }
}
