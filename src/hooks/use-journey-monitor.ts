'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { RouteResult, TransportMode } from '@/lib/types'
import { MODE_LABELS } from '@/lib/constants'
import { LIVE_BANNER_THRESHOLD_SEC } from '@/lib/delay'
import { DelayedVehicle } from '@/app/api/delays/route'

export interface DelayWarning {
  legIndex: number
  route: string
  delaySecs: number
  message: string
}

export function useJourneyMonitor(selectedRoute: RouteResult | null, delayVehicles?: DelayedVehicle[]) {
  const [warnings, setWarnings] = useState<DelayWarning[]>([])
  const dismissedRef = useRef<Set<number>>(new Set())
  const routeIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!selectedRoute) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWarnings([])
      dismissedRef.current = new Set()
      routeIdRef.current = null
      return
    }

    if (routeIdRef.current !== selectedRoute.id) {
      dismissedRef.current = new Set()
      routeIdRef.current = selectedRoute.id
    }

    const nowISO = new Date().toISOString()
    const newWarnings: DelayWarning[] = selectedRoute.legs
      .map((leg, index) => ({ leg, index }))
      .filter(({ leg, index }) =>
        leg.mode !== 'walk' && leg.tripId && leg.endTime > nowISO && !dismissedRef.current.has(index),
      )
      .map(({ leg, index }) => {
        const match = delayVehicles?.find((v) => v.tripId === leg.tripId)
        if (!match || match.delaySeconds < LIVE_BANNER_THRESHOLD_SEC) return null
        return {
          legIndex: index,
          route: leg.route || leg.mode,
          delaySecs: match.delaySeconds,
          message: `${MODE_LABELS[leg.mode as TransportMode]} ${leg.route || ''} is running about ${Math.round(match.delaySeconds / 60)} min late`,
        }
      })
      .filter((w): w is DelayWarning => w !== null)

    setWarnings(newWarnings)
  }, [selectedRoute, delayVehicles])

  const dismissWarning = useCallback((legIndex: number) => {
    dismissedRef.current.add(legIndex)
    setWarnings((prev) => prev.filter((w) => w.legIndex !== legIndex))
  }, [])

  return { warnings, dismissWarning }
}
