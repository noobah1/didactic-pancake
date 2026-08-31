'use client'

import { useEffect, useRef } from 'react'
import { RouteResult, RouteLeg, VehiclePosition, TransportMode } from '@/lib/types'
import { distanceMeters, findVehicleForLeg } from '@/lib/delay'
import { DelayedVehicle } from '@/app/api/delays/route'
import { useTranslation } from '@/lib/i18n/context'

// How often the "leave now" alarm re-checks the wall clock against its
// target time. A plain setTimeout for a delay that can be tens of minutes
// long doesn't survive a laptop sleep or a suspended mobile tab reliably —
// it can fire hours late, or not at all — where polling against Date.now()
// means even a late-running tick still compares correctly against real
// elapsed time. use-riding-mode.ts's own alarm sidesteps this same problem
// for free by being driven off live GPS fixes rather than a timer; this
// alarm has no such fixes to piggyback on, so it polls instead.
const LEAVE_CHECK_INTERVAL_MS = 15_000

// How close the tracked vehicle must get to the boarding stop to count as
// "arriving" — same idea as riding-progress.ts's ALIGHT_ALARM_RADIUS_M, but
// a bit wider: a rider still walking up needs a few extra seconds' notice to
// actually reach the stop, where a riding alarm's rider is already on board
// and can react instantly.
const BOARDING_ALARM_RADIUS_M = 350

// Best-effort local alarm: vibrate plus, when permission was already
// granted, a service-worker notification — same mechanism (and the same
// public/sw.js notificationclick handler) as use-riding-mode.ts's own
// alertAlighting. Works whether or not the tab is focused; never blocks or
// throws.
function notify(title: string, body: string, tag: string) {
  if (typeof navigator === 'undefined') return
  if ('vibrate' in navigator) navigator.vibrate([200, 100, 200])
  if (!('serviceWorker' in navigator) || typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  navigator.serviceWorker.ready
    .then((reg) => reg.showNotification(title, { body, tag }))
    .catch(() => {})
}

// Finds the live position of the vehicle running `leg`, same matching order
// RouteCard/page.tsx already use for their own delay badges: an exact
// tripId match against the GPS delay feed first, then that feed's own
// schedule-interpolated fallback list, then findVehicleForLeg's position/
// heading search. Kept local rather than reused from page.tsx's own
// journeyVehicles — that array silently skips legs with no match at all, so
// its indices don't line up 1:1 with route.legs and can't safely be sliced
// down to "the first transit leg's vehicle" from outside.
function findLegVehicle(
  leg: RouteLeg,
  delayVehicles: DelayedVehicle[] | undefined,
  vehicles: VehiclePosition[] | undefined,
  nowMs: number,
): { lat: number; lng: number } | null {
  if (leg.tripId) {
    const gpsMatch = delayVehicles?.find((v) => v.tripId === leg.tripId)
    if (gpsMatch) return gpsMatch
    const scheduledMatch = vehicles?.find((v) => v.id === leg.tripId)
    if (scheduledMatch) return scheduledMatch
  }
  return findVehicleForLeg(leg, vehicles || [], nowMs)
}

// Two best-effort alarms for a journey you've selected but haven't boarded
// yet — the gap use-riding-mode.ts's own get-off alarm deliberately doesn't
// cover, since that one only ever runs once a leg is actually being ridden.
//
// "Leave now" fires once, at the route's planned start time, shifted later
// by any GPS-confirmed delay already known for the first transit leg (a bus
// running 5 minutes late buys you 5 more minutes before you need to leave).
// "Bus arriving" fires once the live-tracked vehicle for that same leg gets
// within BOARDING_ALARM_RADIUS_M of its boarding stop.
//
// Deliberately scoped to only the route's very first transit leg: a rider
// already past that first boarding, mid-journey on a later leg or transfer,
// is exactly what riding mode (and its own alighting alarm) exists for
// instead — re-deriving "which leg is next" independent of an active riding
// session would need its own journey-progress tracking that doesn't exist
// outside of it.
export function useDepartureAlert(
  route: RouteResult | null,
  delayVehicles: DelayedVehicle[] | undefined,
  vehicles: VehiclePosition[] | undefined,
  ridingTripId: string | null,
) {
  const { t, modeLabel } = useTranslation()
  const routeId = route?.id ?? null
  const firstTransitLeg = route?.legs.find((l) => l.mode !== 'walk') ?? null

  // Read from inside the effects below without forcing either one to
  // restart on every fresh delay/vehicle poll — only routeId (and the leg it
  // resolves to, stable for as long as the same route stays selected: see
  // use-route-plan.ts, which never re-plans a route once fetched) should
  // reset either alarm.
  const delayVehiclesRef = useRef(delayVehicles)
  delayVehiclesRef.current = delayVehicles

  useEffect(() => {
    if (!routeId || !firstTransitLeg) return
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }

    const startMs = new Date(route!.startTime).getTime()
    const currentDelaySec = () =>
      firstTransitLeg.tripId
        ? (delayVehiclesRef.current?.find((v) => v.tripId === firstTransitLeg.tripId)?.delaySeconds ?? 0)
        : 0

    // Selecting a route whose leave time (even accounting for a currently-
    // known delay) has already passed shouldn't immediately fire — this
    // alarm is only for a moment that's still ahead of you when you pick
    // the route.
    let alarmed = Date.now() >= startMs + Math.max(0, currentDelaySec()) * 1000

    const interval = setInterval(() => {
      if (alarmed) return
      const leaveAtMs = startMs + Math.max(0, currentDelaySec()) * 1000
      if (Date.now() < leaveAtMs) return
      alarmed = true
      notify(
        t('departureAlert.leaveTitle'),
        t('departureAlert.leaveBody', {
          mode: modeLabel(firstTransitLeg.mode as TransportMode),
          route: firstTransitLeg.route || '',
        }),
        'departure-leave',
      )
    }, LEAVE_CHECK_INTERVAL_MS)

    return () => clearInterval(interval)
    // t/modeLabel intentionally excluded — a locale switch mid-wait shouldn't
    // restart (and re-arm) this alarm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId])

  const arrivingAlarmedRef = useRef(false)
  useEffect(() => {
    arrivingAlarmedRef.current = false
  }, [routeId])

  useEffect(() => {
    if (!route || !firstTransitLeg || arrivingAlarmedRef.current) return
    // Already boarded this leg — use-riding-mode.ts's own alighting alarm
    // covers everything from here on; this one is only for the wait
    // beforehand.
    if (firstTransitLeg.tripId && firstTransitLeg.tripId === ridingTripId) return
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }

    const vehicle = findLegVehicle(firstTransitLeg, delayVehicles, vehicles, Date.now())
    if (!vehicle) return
    const dist = distanceMeters(vehicle.lat, vehicle.lng, firstTransitLeg.from.lat, firstTransitLeg.from.lng)
    if (dist > BOARDING_ALARM_RADIUS_M) return

    arrivingAlarmedRef.current = true
    notify(
      t('departureAlert.arrivingTitle'),
      t('departureAlert.arrivingBody', {
        mode: modeLabel(firstTransitLeg.mode as TransportMode),
        route: firstTransitLeg.route || '',
      }),
      'departure-arriving',
    )
  }, [route, firstTransitLeg, delayVehicles, vehicles, ridingTripId, t, modeLabel])
}
