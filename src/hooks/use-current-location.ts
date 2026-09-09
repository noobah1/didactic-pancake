'use client'

import { useState, useCallback, useRef } from 'react'

export type LocationStatus = 'idle' | 'locating' | 'granted' | 'denied' | 'unavailable'

export interface UserLocation {
  lat: number
  lng: number
  accuracy: number // metres
}

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 30_000,
}

export function useCurrentLocation() {
  const [location, setLocation] = useState<UserLocation | null>(null)
  const [status, setStatus] = useState<LocationStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef(false)

  const locate = useCallback((): Promise<UserLocation | null> => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setStatus('unavailable')
      setError('Location is not supported by this browser')
      return Promise.resolve(null)
    }

    // getCurrentPosition is blocked outside secure contexts and fails silently
    // in some browsers — check explicitly so we can show a real message.
    if (!window.isSecureContext) {
      setStatus('unavailable')
      setError('Location requires an https connection')
      return Promise.resolve(null)
    }

    if (pendingRef.current) return Promise.resolve(null)
    pendingRef.current = true
    setStatus('locating')
    setError(null)

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          pendingRef.current = false
          const next: UserLocation = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }
          setLocation(next)
          setStatus('granted')
          resolve(next)
        },
        (err) => {
          pendingRef.current = false
          if (err.code === err.PERMISSION_DENIED) {
            setStatus('denied')
            setError('Location permission denied')
          } else if (err.code === err.TIMEOUT) {
            setStatus('unavailable')
            setError('Could not get your location in time')
          } else {
            setStatus('unavailable')
            setError('Location unavailable')
          }
          resolve(null)
        },
        GEO_OPTIONS,
      )
    })
  }, [])

  return { location, status, error, locate }
}
