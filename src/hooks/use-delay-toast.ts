'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { OVERVIEW_THRESHOLD_SEC } from '@/lib/delay'
import { TransportMode } from '@/lib/types'
import { DelayedVehicle } from '@/app/api/delays/route'
import { useTranslation } from '@/lib/i18n/context'
import { formatMinutesLocalized } from '@/lib/i18n/format'

const TOAST_DURATION_MS = 6_000

export interface DelayToastMessage {
  text: string
}

// resetKey identifies "what we're watching" (e.g. the selected route's id).
// Passing a new value re-arms the toast as if it were a fresh first load —
// without this, switching to a route that already has a delay in progress
// (very common: you just searched, so any live delay is by definition
// "already existing") would fire an immediate toast for a route you haven't
// even committed to yet, since its vehicle ids were never in seenIdsRef.
export function useDelayToast(vehicles: DelayedVehicle[], resetKey: string | null = null) {
  const { t, modeLabel } = useTranslation()
  const [toast, setToast] = useState<DelayToastMessage | null>(null)
  const seenIdsRef = useRef<Set<string> | null>(null)
  const resetKeyRef = useRef<string | null>(resetKey)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const delayed = vehicles.filter((v) => v.delaySeconds >= OVERVIEW_THRESHOLD_SEC)
    const currentIds = new Set(delayed.map((v) => v.vehicleId))

    if (seenIdsRef.current === null || resetKeyRef.current !== resetKey) {
      // First load, or what we're watching just changed — don't toast for
      // delays that already existed before we started watching this.
      resetKeyRef.current = resetKey
      seenIdsRef.current = currentIds
      return
    }

    const newlyDelayed = delayed.filter((v) => !seenIdsRef.current!.has(v.vehicleId))
    seenIdsRef.current = currentIds

    if (newlyDelayed.length === 0) return

    const text =
      newlyDelayed.length === 1
        ? t('delayToast.vehicleLate', {
            mode: modeLabel(newlyDelayed[0].mode as TransportMode),
            line: newlyDelayed[0].line,
            destination: newlyDelayed[0].destination,
            duration: formatMinutesLocalized(Math.round(newlyDelayed[0].delaySeconds / 60), t),
          })
        : t('delayToast.multipleLate', { n: newlyDelayed.length })

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToast({ text })

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS)
  }, [vehicles, resetKey, t, modeLabel])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast(null)
  }, [])

  return { toast, dismiss }
}
