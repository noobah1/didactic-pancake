'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { OVERVIEW_THRESHOLD_SEC } from '@/lib/delay'
import { MODE_LABELS } from '@/lib/constants'
import { TransportMode } from '@/lib/types'
import { DelayedVehicle } from '@/app/api/delays/route'

const TOAST_DURATION_MS = 6_000

export interface DelayToastMessage {
  text: string
}

export function useDelayToast(vehicles: DelayedVehicle[]) {
  const [toast, setToast] = useState<DelayToastMessage | null>(null)
  const seenIdsRef = useRef<Set<string> | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const delayed = vehicles.filter((v) => v.delaySeconds >= OVERVIEW_THRESHOLD_SEC)
    const currentIds = new Set(delayed.map((v) => v.vehicleId))

    if (seenIdsRef.current === null) {
      // First load — don't toast for delays that already existed before we started watching
      seenIdsRef.current = currentIds
      return
    }

    const newlyDelayed = delayed.filter((v) => !seenIdsRef.current!.has(v.vehicleId))
    seenIdsRef.current = currentIds

    if (newlyDelayed.length === 0) return

    const text =
      newlyDelayed.length === 1
        ? `${MODE_LABELS[newlyDelayed[0].mode as TransportMode]} ${newlyDelayed[0].line} → ${newlyDelayed[0].destination} is running ${Math.round(newlyDelayed[0].delaySeconds / 60)} min late`
        : `${newlyDelayed.length} vehicles are now running late`

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToast({ text })

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS)
  }, [vehicles])

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
