'use client'
 
import { useState, useEffect, useRef, useCallback } from 'react'
import { RouteResult, RouteLeg, VehiclePosition } from '@/lib/types'
 
export interface DelayWarning {
  legIndex: number
  route: string
  delaySecs: number
  message: string
}
 
const POLL_INTERVAL = 10_000
const DELAY_THRESHOLD = 60
 
function getSecondsSinceMidnight(): number {
  const now = new Date()
  const parts = now.toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Tallinn',
    hour12: false,
  }).split(':')
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
}
 
function distanceDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dlat = lat2 - lat1
  const dlng = lng2 - lng1
  return Math.sqrt(dlat * dlat + dlng * dlng)
}
 
function estimateDelay(vehicle: VehiclePosition, leg: RouteLeg): number {
  const nowSec = getSecondsSinceMidnight()
  const scheduledDep = new Date(leg.startTime)
  const scheduledDepSec =
    scheduledDep.getHours() * 3600 +
    scheduledDep.getMinutes() * 60 +
    scheduledDep.getSeconds()
 
  const distToOrigin = distanceDeg(vehicle.lat, vehicle.lng, leg.from.lat, leg.from.lng)
  if (distToOrigin < 0.003 && nowSec > scheduledDepSec + DELAY_THRESHOLD) {
    return nowSec - scheduledDepSec
  }
 
  const stops = [leg.from, ...(leg.intermediateStops || []), leg.to]
  let expectedStopIndex = 0
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]
    const stopTimeSec = stop.departure
      ? (() => {
          const d = new Date(stop.departure)
          return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
        })()
      : null
    if (stopTimeSec && nowSec >= stopTimeSec) {
      expectedStopIndex = i
    }
  }
 
  let nearestStopIndex = 0
  let nearestDist = Infinity
  for (let i = 0; i < stops.length; i++) {
    const d = distanceDeg(vehicle.lat, vehicle.lng, stops[i].lat, stops[i].lng)
    if (d < nearestDist) {
      nearestDist = d
      nearestStopIndex = i
    }
  }
 
  const stopsBehind = expectedStopIndex - nearestStopIndex
  if (stopsBehind <= 0) return 0
 
  const avgStopInterval = stops.length > 1 ? leg.duration / (stops.length - 1) : 60
  return Math.round(stopsBehind * avgStopInterval)
}
 
export function useJourneyMonitor(selectedRoute: RouteResult | null) {
  const [warnings, setWarnings] = useState<DelayWarning[]>([])
  const dismissedRef = useRef<Set<number>>(new Set())
  const routeIdRef = useRef<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
 
  const checkDelays = useCallback(async (route: RouteResult) => {
    const transitLegs = route.legs
      .map((leg, index) => ({ leg, index }))
      .filter(({ leg }) => leg.mode !== 'walk' && leg.tripId)
 
    if (transitLegs.length === 0) return
 
    const nowISO = new Date().toISOString()
    const activeLegs = transitLegs.filter(({ leg }) => leg.endTime > nowISO)
    if (activeLegs.length === 0) return
 
    try {
      const res = await fetch('/api/vehicles?modes=bus,tram,train,ferry')
      if (!res.ok) return
      const data = await res.json()
      const vehicles: VehiclePosition[] = data.vehicles || []
 
      const newWarnings: DelayWarning[] = []
      for (const { leg, index } of activeLegs) {
        if (dismissedRef.current.has(index)) continue
        const vehicle = vehicles.find((v) => v.id === leg.tripId)
        if (!vehicle) continue
        const delaySecs = estimateDelay(vehicle, leg)
        if (delaySecs >= DELAY_THRESHOLD) {
          newWarnings.push({
            legIndex: index,
            route: leg.route || leg.mode,
            delaySecs,
            message: `Bus ${leg.route || leg.mode} is running about ${Math.round(delaySecs / 60)} min late`,
          })
        }
      }
 
      setWarnings(newWarnings)
    } catch {
      // silently fail
    }
  }, [])
 
  useEffect(() => {
    if (!selectedRoute) {
      setWarnings([])
      dismissedRef.current = new Set()
      routeIdRef.current = null
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }
 
    if (routeIdRef.current !== selectedRoute.id) {
      dismissedRef.current = new Set()
      routeIdRef.current = selectedRoute.id
    }
 
    checkDelays(selectedRoute)
    intervalRef.current = setInterval(() => checkDelays(selectedRoute), POLL_INTERVAL)
 
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [selectedRoute?.id, checkDelays])
 
  const dismissWarning = useCallback((legIndex: number) => {
    dismissedRef.current.add(legIndex)
    setWarnings((prev) => prev.filter((w) => w.legIndex !== legIndex))
  }, [])
 
  return { warnings, dismissWarning }
}