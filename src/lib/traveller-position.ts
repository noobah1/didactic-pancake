import { RouteResult, RouteLeg, VehiclePosition, SharePosition, TravellerPosition } from '@/lib/types'
import { DelayedVehicle } from '@/app/api/delays/route'
import { findVehicleForLeg, positionAlongLeg } from '@/lib/delay'
import { formatAgo } from '@/lib/format-ago'
import type { Locale } from '@/lib/i18n/types'
import en from '@/lib/i18n/en'
import et from '@/lib/i18n/et'
import ru from '@/lib/i18n/ru'

const TRAVELLER_DICTS = { en, et, ru }

// A real GPS fix younger than this is trusted outright. Older than this and
// the sender's phone may simply have gone quiet (screen locked, app
// backgrounded — see use-live-share.ts's own comment on why the web can't
// prevent that) rather than genuinely still be at that exact point, so a
// fresher signal — the vehicle they're on, or the timetable — is preferred
// over freezing the last real fix in place.
export const FRESH_GPS_MAX_AGE_MS = 90_000

// How long past a journey's scheduled end an inferred (non-GPS) position is
// still attempted — long enough to cover ordinary lateness, short enough
// that a journey nobody ever closed out doesn't keep "estimating" forever.
export const JOURNEY_END_GRACE_MS = 30 * 60 * 1000

// Same three-step chain page.tsx's own journeyVehicles already uses to find
// the live vehicle running a leg: exact tripId against the GPS-confirmed
// delay feed, then exact tripId against the schedule-interpolated vehicle
// feed, then findVehicleForLeg's position/heading fallback. Duplicated here
// (rather than imported from page.tsx, a client component) because this
// needs to run as a plain function reusable from both the server-fed
// useMemo in page.tsx and from tests.
function resolveLegVehicle(
  leg: RouteLeg,
  delayVehicles: DelayedVehicle[],
  vehicles: VehiclePosition[],
  nowMs: number,
): VehiclePosition | null {
  if (leg.mode === 'walk') return null

  if (leg.tripId) {
    const gpsMatch = delayVehicles.find((v) => v.tripId === leg.tripId)
    if (gpsMatch) {
      return {
        id: gpsMatch.vehicleId,
        mode: gpsMatch.mode,
        line: gpsMatch.line,
        lat: gpsMatch.lat,
        lng: gpsMatch.lng,
        heading: gpsMatch.heading,
        destination: gpsMatch.destination,
      }
    }
    const scheduledMatch = vehicles.find((v) => v.id === leg.tripId)
    if (scheduledMatch) return scheduledMatch
  }

  return findVehicleForLeg(leg, vehicles, nowMs)
}

// The leg a traveller is presumed to currently be on: the first leg not yet
// finished, or the journey's last leg once everything has finished (still
// used by the 'stale' tier below, which needs a route to check endTime
// against, not a specific leg to draw from). Same "endTime > now" framing
// use-journey-monitor.ts already uses to decide which legs are still ahead.
function currentLeg(route: RouteResult, nowMs: number): RouteLeg {
  return route.legs.find((leg) => nowMs <= new Date(leg.endTime).getTime()) ?? route.legs[route.legs.length - 1]
}

// Resolves what to actually draw for a shared journey's traveller, from a
// real GPS fix down to a pure timetable guess. Never lets an inferred
// position run for a share the owner hasn't opted into live sharing for —
// `sharing` (not merely `position` being present) is the gate, since a
// present-but-stale position alone doesn't prove consent is still current
// (see share-store.ts's own comment on why `sharing` is a separate flag).
export function resolveTravellerPosition(input: {
  route: RouteResult
  position: SharePosition | null
  sharing: boolean
  delayVehicles?: DelayedVehicle[]
  vehicles?: VehiclePosition[]
  nowMs: number
  // Defaults to English so existing callers/tests that don't pass one see
  // the same labels as before.
  locale?: Locale
}): TravellerPosition | null {
  const { route, position, sharing, delayVehicles = [], vehicles = [], nowMs, locale = 'en' } = input
  const dict = TRAVELLER_DICTS[locale]

  if (!position && !sharing) return null

  // A fresh real fix is trusted unconditionally, even once the journey has
  // run past its scheduled end (+ grace) — that's exactly what a genuinely
  // late journey looks like, and the sender is still actively broadcasting
  // real GPS, so "Live" is the correct, honest label. The grace cutoff below
  // exists to bound INFERENCE (a dead battery's last fix shouldn't keep
  // "estimating" a moving position forever), not to second-guess a fix that
  // just arrived.
  if (position) {
    const ageMs = nowMs - position.updatedAt
    if (ageMs <= FRESH_GPS_MAX_AGE_MS) {
      return { lat: position.lat, lng: position.lng, source: 'gps', label: dict.traveller.live, ageMs }
    }
  }

  const journeyEndMs = new Date(route.endTime).getTime()
  const pastGrace = nowMs > journeyEndMs + JOURNEY_END_GRACE_MS

  // Inference requires live consent and a journey still plausibly underway.
  // Once either fails, fall back to the last real fix (if any) rather than
  // ever inventing a position with no fix behind it at all.
  if (!sharing || pastGrace) {
    if (!position) return null
    const ageMs = nowMs - position.updatedAt
    return {
      lat: position.lat,
      lng: position.lng,
      source: 'stale',
      label: dict.traveller.lastSeen.replace('{ago}', formatAgo(ageMs, locale)),
      ageMs,
    }
  }

  const ageMs = position ? nowMs - position.updatedAt : 0
  const leg = currentLeg(route, nowMs)

  const legVehicle = resolveLegVehicle(leg, delayVehicles, vehicles, nowMs)
  if (legVehicle) {
    return {
      lat: legVehicle.lat,
      lng: legVehicle.lng,
      source: 'vehicle',
      label: dict.traveller.onVehicle
        .replace('{mode}', dict.modes[legVehicle.mode])
        .replace('{line}', legVehicle.line),
      ageMs,
      mode: legVehicle.mode,
    }
  }

  const { lat, lng } = positionAlongLeg(leg, nowMs)
  return { lat, lng, source: 'schedule', label: dict.traveller.estimatedFromTimetable, ageMs }
}
