'use client'

import { useCallback, useState } from 'react'
import { useTranslation } from '@/lib/i18n/context'

export interface GeoPosition {
  lat: number
  lng: number
}

// One-shot geolocation (getCurrentPosition, not watchPosition) — mirrors
// LocationInput.tsx's "use my location" button exactly (same options, same
// two error strings) so a rider never sees two different phrasings of the
// same failure depending on which part of the app asked.
export function useGeolocation() {
  const { t } = useTranslation()
  const [position, setPosition] = useState<GeoPosition | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const request = useCallback(() => {
    if (!navigator.geolocation) {
      setError(t('location.geolocationUnsupported'))
      return
    }
    setLoading(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoading(false)
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      (err) => {
        setLoading(false)
        setError(err.code === err.PERMISSION_DENIED ? t('location.locationDenied') : t('location.locationUnavailable'))
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [t])

  return { position, error, loading, request }
}
