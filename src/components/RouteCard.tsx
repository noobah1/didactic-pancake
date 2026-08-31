'use client'

import { useMemo, useState } from 'react'
import { Footprints, X, Accessibility } from 'lucide-react'
import { RouteResult, RouteLeg, LegPlace, TransportMode, ItineraryConditions, LegTrafficEstimate, ItineraryFare } from '@/lib/types'
import { MODE_COLORS } from '@/lib/constants'
import { ROUTE_PLAN_MATCH_WINDOW_SEC, findVehicleForLeg } from '@/lib/delay'
import { DelayedVehicle } from '@/app/api/delays/route'
import { useTranslation } from '@/lib/i18n/context'
import { formatMinutesLocalized, formatEuroLocalized } from '@/lib/i18n/format'
import { Locale } from '@/lib/i18n/types'
import { useRiderProfile } from '@/hooks/use-rider-profile'
import { priceItinerary } from '@/lib/fares/price'

// Modes with a live position feed behind them: Tallinn's own for the road
// modes, Elron's for trains (see src/lib/elron.ts). Ferry has none, so a
// ferry leg can only ever show its scheduled time.
const GPS_MODES = new Set<TransportMode>(['bus', 'tram', 'trolleybus', 'nightbus', 'train'])

interface RouteCardProps {
  route: RouteResult
  selected: boolean
  onSelect: () => void
  delayVehicles?: DelayedVehicle[]
  // This itinerary's own leg-scoped traffic conditions (see
  // ItineraryConditions), already resolved by RouteResults from the polled
  // /api/route-conditions response by routeId — RouteCard never needs to
  // know about any other itinerary's.
  conditions?: ItineraryConditions
  // The tripId of the leg currently being ridden (see use-riding-mode.ts),
  // if any — there's only ever one riding session app-wide, so this is
  // compared against each leg's own tripId to show "Stop" instead of "I'm on
  // this" on the right one, even across different RouteCards.
  ridingTripId?: string | null
  onToggleRiding?: (leg: RouteLeg) => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Tallinn' })
}

// Elron trains only — see LegPlace.platform. A leg's `from` and `to` are
// looked up independently (departure vs. arrival platform), so they're
// frequently different tracks at the same station.
function PlatformBadge({ place }: { place: LegPlace }) {
  const { t } = useTranslation()
  if (!place.platform) return null
  return (
    <span
      title={place.platformChanged ? t('route.platformChanged') : undefined}
      className={`shrink-0 px-1 py-0.5 rounded text-[10px] font-semibold ${
        place.platformChanged
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
      }`}
    >
      {t('route.platformShort', { n: place.platform })}
    </span>
  )
}

// OTP-sourced disruption(s) for this specific leg's trip/route — separate
// from IssuesPanel's city-wide alerts, which never say whether *this* leg is
// affected. A CANCELED realtimeState is called out even with no matching
// alert text, since the static timetable alone would never reveal it.
function LegAlertRow({ leg }: { leg: RouteLeg }) {
  const { t } = useTranslation()
  const cancelled = leg.realtimeState === 'canceled'
  const alerts = leg.alerts || []
  if (!cancelled && alerts.length === 0) return null
  const severe = cancelled || alerts.some((a) => a.severity === 'severe')

  return (
    <div
      className={`flex items-start gap-1.5 mx-0 mb-1 px-2 py-1 rounded text-xs ${
        severe
          ? 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300'
          : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
      }`}
    >
      <span className="shrink-0 leading-none mt-0.5">⚠️</span>
      <span className="leading-snug">
        {cancelled && <span className="font-semibold">{t('route.tripCancelled')} </span>}
        {alerts.map((a, i) => (
          <span key={i}>
            {a.headerText}
            {i < alerts.length - 1 ? ' · ' : ''}
          </span>
        ))}
      </span>
    </div>
  )
}

// leg.wheelchairAccessible is three-state (see RouteLeg's own comment):
// undefined means the operator simply didn't report it, the majority case
// for Estonian trips, and must never read as a "no" — so this renders
// nothing at all for undefined rather than an "unknown" badge, the same
// silent-when-absent choice PlatformBadge above makes.
function WheelchairBadge({ leg }: { leg: RouteLeg }) {
  const { t } = useTranslation()
  if (leg.wheelchairAccessible === undefined) return null
  return (
    <span
      title={leg.wheelchairAccessible ? t('route.wheelchairAccessible') : t('route.wheelchairNotAccessible')}
      aria-label={leg.wheelchairAccessible ? t('route.wheelchairAccessible') : t('route.wheelchairNotAccessible')}
      className={`shrink-0 flex items-center justify-center w-4 h-4 rounded-full ${
        leg.wheelchairAccessible
          ? 'text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/60'
          : 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/60'
      }`}
    >
      <Accessibility size={11} strokeWidth={2.5} />
    </span>
  )
}

// Header price chip. 'tariff' is a plain confirmed-looking label since every
// leg has a published fixed price; 'floor'/'operator' get the outlined
// treatment (same "estimated, not confirmed" visual language as the traffic
// chip below, but neutral rather than amber — this is a pricing-confidence
// axis, not a delay one) since the number is only a lower bound or absent
// entirely. 'unknown' renders nothing rather than a fabricated number.
function FareChip({ fare, locale, t }: { fare: ItineraryFare; locale: Locale; t: (path: string, vars?: Record<string, string | number>) => string }) {
  if (fare.evidence === 'unknown') return null
  if (fare.evidence === 'operator') {
    return <span className="text-xs text-gray-500 dark:text-gray-400 font-medium border border-gray-300 dark:border-gray-600 rounded px-1">{t('fare.atOperator')}</span>
  }
  if (fare.totalCents === undefined) return null
  if (fare.evidence === 'floor') {
    return (
      <span className="text-xs text-gray-500 dark:text-gray-400 font-medium border border-gray-300 dark:border-gray-600 rounded px-1">
        {t('fare.from', { price: formatEuroLocalized(fare.totalCents, locale) })}
      </span>
    )
  }
  return (
    <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">
      {fare.totalCents === 0 ? t('fare.free') : formatEuroLocalized(fare.totalCents, locale)}
    </span>
  )
}

// Expanded-view breakdown, one row per ticket the rider actually buys after
// transfer combining (see priceItinerary) — never one row per leg, since two
// legs on the same authority within its transfer window share a ticket.
function FareBreakdown({ fare, locale, t }: { fare: ItineraryFare; locale: Locale; t: (path: string, vars?: Record<string, string | number>) => string }) {
  if (fare.tickets.length === 0) return null
  return (
    <div className="mt-1 pt-1.5 border-t border-gray-100 dark:border-gray-700 flex flex-col gap-1">
      {fare.tickets.map((ticket, i) => (
        <div key={i} className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>{t('fare.ticketFor', { authority: ticket.authority })}</span>
          <span className="flex items-center gap-2">
            <span className="font-medium text-gray-700 dark:text-gray-200">
              {ticket.evidence === 'operator' || ticket.evidence === 'unknown'
                ? t('fare.atOperator')
                : ticket.evidence === 'floor'
                  ? t('fare.from', { price: formatEuroLocalized(ticket.cents ?? 0, locale) })
                  : ticket.cents === 0
                    ? t('fare.free')
                    : formatEuroLocalized(ticket.cents ?? 0, locale)}
            </span>
            {ticket.fareUrl && (
              <a
                href={ticket.fareUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                {t('fare.buyAt', { site: new URL(ticket.fareUrl).hostname })}
              </a>
            )}
          </span>
        </div>
      ))}
      <div className="text-[11px] text-gray-400 dark:text-gray-500">
        {t('fare.estimateDisclaimer')} {fare.pricesAsOf && t('fare.pricesAsOf', { date: fare.pricesAsOf })}
      </div>
    </div>
  )
}

// Shared between ExpandableLeg's own toggle and RouteCard's summary-chip
// toggle (see the transitLegs.map below) — same intermediate-stops list,
// two different places a rider can ask to see it from.
function LegStopsList({ leg, color }: { leg: RouteLeg; color: string }) {
  const stops = leg.intermediateStops || []
  return (
    <div className="ml-1 pl-2 border-l-2 mb-1" style={{ borderColor: color }}>
      <div className="flex items-center gap-2 py-0.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{formatTime(leg.startTime)}</span>
        <span className="text-xs text-gray-600 dark:text-gray-300">{leg.from.name}</span>
        <PlatformBadge place={leg.from} />
      </div>
      {stops.map((stop, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-1 h-1 rounded-full bg-gray-400 dark:bg-gray-500" />
          <span className="text-xs text-gray-400 dark:text-gray-500">{stop.departure ? formatTime(stop.departure) : ''}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{stop.name}</span>
        </div>
      ))}
      <div className="flex items-center gap-2 py-0.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{formatTime(leg.endTime)}</span>
        <span className="text-xs text-gray-600 dark:text-gray-300">{leg.to.name}</span>
        <PlatformBadge place={leg.to} />
      </div>
    </div>
  )
}

function ExpandableLeg({
  leg,
  riding,
  onToggleRiding,
  trafficEstimate,
}: {
  leg: RouteLeg
  riding: boolean
  onToggleRiding?: (leg: RouteLeg) => void
  // This specific leg's own slowdown, if the leg's route is covered and
  // currently shows one (see ItineraryConditions.legs) — the whole point of
  // going leg-scoped is being able to point at which leg is actually slow,
  // not just the itinerary as a whole.
  trafficEstimate?: LegTrafficEstimate
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const color = MODE_COLORS[leg.mode as keyof typeof MODE_COLORS] || '#6B7280'
  const stops = leg.intermediateStops || []

  return (
    <div>
      <LegAlertRow leg={leg} />
      {/* A `div` with role="button", not a real <button> — it needs to
          contain the "I'm on this" button below (same nested-interactive
          pattern RouteCard's own outer card already uses for its X button),
          which an actual <button> can't validly nest. stopPropagation is
          required here — this row lives inside RouteCard's own outer
          role="button" div (onSelect), so without it toggling one leg's
          stop list also toggled the whole route off. */}
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setExpanded(!expanded) } }}
        className="w-full flex items-center justify-between py-1.5 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="px-1.5 py-0.5 rounded text-xs font-bold text-white"
            style={{ backgroundColor: color }}
          >
            {leg.route || leg.mode}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{formatTime(leg.startTime)}</span>
          <span className="text-xs text-gray-600 dark:text-gray-300 truncate">{leg.from.name} &rarr; {leg.to.name}</span>
          <PlatformBadge place={leg.from} />
          <WheelchairBadge leg={leg} />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onToggleRiding && leg.tripId && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleRiding(leg) }}
              className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                riding
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              {riding ? t('riding.stopRiding') : t('riding.imOnThis')}
            </button>
          )}
          {trafficEstimate && (
            // Same outlined-amber "estimated, not confirmed" treatment as the
            // card's own itinerary-level adjunct — this is the leg it's
            // actually summed from.
            <span
              className="text-xs text-amber-600 dark:text-amber-400 font-medium border border-amber-400 dark:border-amber-600 rounded px-1"
              title={t('route.trafficPointsTooltip', { n: trafficEstimate.detectorCount, plural: trafficEstimate.detectorCount === 1 ? '' : 's' })}
            >
              {t('route.delaySlower', {
                range: Math.round(trafficEstimate.maxSeconds / 60) > Math.round(trafficEstimate.minSeconds / 60)
                  ? `${Math.round(trafficEstimate.minSeconds / 60)}-${Math.round(trafficEstimate.maxSeconds / 60)}`
                  : `${Math.round(trafficEstimate.minSeconds / 60)}`,
              })}
            </span>
          )}
          <span className="text-xs text-gray-400 dark:text-gray-500">{t('common.minShort', { n: Math.round(leg.duration / 60) })}</span>
          {stops.length > 0 && (
            <svg
              className={`w-3.5 h-3.5 text-gray-400 ${expanded ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
            </svg>
          )}
        </div>
      </div>
      {expanded && stops.length > 0 && <LegStopsList leg={leg} color={color} />}
    </div>
  )
}

export function RouteCard({ route, selected, onSelect, delayVehicles, conditions, ridingTripId, onToggleRiding }: RouteCardProps) {
  const { t, modeLabel, locale } = useTranslation()
  const { profile } = useRiderProfile()
  const fare = useMemo(() => priceItinerary(route, profile), [route, profile])
  const transitLegs = route.legs.filter((l) => l.mode !== 'walk')
  // Which transit-leg chip's stop list is showing, if any — independent of
  // `selected`, so a rider can tap a bus/tram badge to see the stops it
  // passes through without first having to pick this itinerary. Index into
  // transitLegs, not route.legs, since that's what's rendered below.
  const [expandedChipIndex, setExpandedChipIndex] = useState<number | null>(null)
  const walkMinutes = Math.round(
    route.legs.filter((l) => l.mode === 'walk').reduce((sum, l) => sum + l.duration, 0) / 60,
  )
  const totalMinutes = Math.round(route.duration / 60)
  const startTime = formatTime(route.startTime)
  const endTime = formatTime(route.endTime)

  // Only attempt a live match for GPS-covered modes whose scheduled departure
  // is near enough to "now" that a live vehicle could plausibly be running —
  // a leg hours away, or on ferry/other-city bus, has no live vehicle to
  // match against and must show a neutral "Scheduled" state, never a guessed
  // "on time".
  const nowMs = new Date().getTime()
  const knownDelays = transitLegs
    .filter((leg) =>
      GPS_MODES.has(leg.mode as TransportMode) &&
      Math.abs(new Date(leg.startTime).getTime() - nowMs) <= ROUTE_PLAN_MATCH_WINDOW_SEC * 1000,
    )
    .map((leg) => {
      // Exact tripId match first, but it frequently misses even for a
      // vehicle that's genuinely running and delayed right now — OTP's
      // schedule-based "next trip" pick and the live GPS matcher's
      // position-based pick can each independently and correctly land on a
      // different physical run of the same route (see findVehicleForLeg).
      // Without the fallback, this card defaulted to "Scheduled" far more
      // often than the trip was actually unmatched, in cases where a rider
      // would clearly see their bus was already running late.
      const exact = leg.tripId ? delayVehicles?.find((v) => v.tripId === leg.tripId) : undefined
      return exact ?? findVehicleForLeg(leg, delayVehicles || [], nowMs)
    })
    .filter((d): d is DelayedVehicle => d != null)
  const maxDelaySeconds = knownDelays.length ? Math.max(...knownDelays.map((d) => d.delaySeconds)) : null
  const delayMinutes = maxDelaySeconds !== null ? Math.round(maxDelaySeconds / 60) : null

  // Falls through only when nothing above found a GPS-confirmed delay — same
  // precedence the old whole-route fallback used, just now summed over this
  // itinerary's own leg-scoped estimates (see ItineraryConditions) instead
  // of one arbitrary matching route's whole corridor.
  const legEstimateEntries = conditions ? Object.entries(conditions.legs) : []
  const itineraryEstimate =
    delayMinutes === null && legEstimateEntries.length > 0
      ? {
          minSeconds: conditions!.totalMinSeconds,
          maxSeconds: conditions!.totalMaxSeconds,
          detectorCount: legEstimateEntries.reduce((sum, [, e]) => sum + e.detectorCount, 0),
        }
      : undefined

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect() }}
      className={`w-full text-left p-3 rounded-lg border cursor-pointer ${
        selected
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {transitLegs.length === 0 ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-gray-400 text-white">
              <Footprints size={12} />
              <span className="text-xs font-bold">{t('route.walk')}</span>
            </span>
          ) : (
            <>
              {transitLegs.map((leg, i) => {
                const hasStops = (leg.intermediateStops?.length ?? 0) > 0
                const badge = (
                  <span
                    className="px-2 py-0.5 rounded text-xs font-bold text-white"
                    style={{ backgroundColor: MODE_COLORS[leg.mode === 'walk' ? 'bus' : leg.mode] }}
                  >
                    {leg.route || leg.mode}
                  </span>
                )
                return (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-gray-400 dark:text-gray-500 text-xs">&rarr;</span>}
                    {hasStops ? (
                      // Badge + chevron together are the tap target (not just
                      // the badge alone) — bigger hit area, and the chevron
                      // is the same "tap to see stops" affordance
                      // ExpandableLeg's own row uses further down.
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setExpandedChipIndex(expandedChipIndex === i ? null : i)
                        }}
                        title={t('route.viewStops')}
                        aria-expanded={expandedChipIndex === i}
                        className="flex items-center gap-0.5 cursor-pointer"
                      >
                        {badge}
                        <svg
                          className={`w-3 h-3 text-gray-400 dark:text-gray-500 ${expandedChipIndex === i ? 'rotate-180' : ''}`}
                          fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                        </svg>
                      </button>
                    ) : (
                      <span title={modeLabel(leg.mode === 'walk' ? 'bus' : leg.mode)}>{badge}</span>
                    )}
                  </span>
                )
              })}
              {walkMinutes > 0 && (
                <span
                  className="flex items-center gap-0.5 text-xs text-gray-400 dark:text-gray-500 shrink-0"
                  title={t('route.includesWalking')}
                >
                  <Footprints size={12} />
                  {t('route.durationMin', { n: walkMinutes })}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <FareChip fare={fare} locale={locale} t={t} />
          <span className="font-bold text-sm text-gray-900 dark:text-gray-100">{formatMinutesLocalized(totalMinutes, t)}</span>
          {selected && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSelect() }}
              title={t('route.removeJourney')}
              aria-label={t('route.removeJourney')}
              className="p-0.5 -m-0.5 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      {expandedChipIndex !== null && transitLegs[expandedChipIndex] && (
        <div className="mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
          <LegStopsList
            leg={transitLegs[expandedChipIndex]}
            color={MODE_COLORS[transitLegs[expandedChipIndex].mode === 'walk' ? 'bus' : transitLegs[expandedChipIndex].mode]}
          />
        </div>
      )}
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-gray-500 dark:text-gray-400">{startTime} &rarr; {endTime}</span>
        {transitLegs.length > 0 && (
          delayMinutes === null ? (
            itineraryEstimate ? (
              // Outlined, not solid — visually distinct from the
              // GPS-confirmed amber chip below, same "estimated, not
              // confirmed" honesty rule as MapView's dashed markers for
              // schedule-interpolated vehicles.
              <span
                className="text-xs text-amber-600 dark:text-amber-400 font-medium border border-amber-400 dark:border-amber-600 rounded px-1"
                title={t('route.trafficPointsTooltip', { n: itineraryEstimate.detectorCount, plural: itineraryEstimate.detectorCount === 1 ? '' : 's' })}
              >
                {t('route.delaySlower', {
                  range: Math.round(itineraryEstimate.maxSeconds / 60) > Math.round(itineraryEstimate.minSeconds / 60)
                    ? `${Math.round(itineraryEstimate.minSeconds / 60)}-${Math.round(itineraryEstimate.maxSeconds / 60)}`
                    : `${Math.round(itineraryEstimate.minSeconds / 60)}`,
                })}
              </span>
            ) : (
              <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">{t('route.scheduled')}</span>
            )
          ) : delayMinutes > 0 ? (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">{t('route.delaySuffix', { duration: formatMinutesLocalized(delayMinutes, t) })}</span>
          ) : (
            <span className="text-xs text-green-600 dark:text-green-400 font-medium">{t('route.onTime')}</span>
          )
        )}
      </div>
      {selected && (
        <div className="mt-2 flex flex-col divide-y divide-gray-100 dark:divide-gray-700">
          {route.legs.map((leg, i) => (
            <div key={i}>
              {leg.mode === 'walk' ? (
                <div className="flex items-center gap-2 py-1.5 text-xs text-gray-400 dark:text-gray-500">
                  <Footprints size={14} />
                  <span>{t('route.walkMin', { n: Math.round(leg.duration / 60) })}</span>
                </div>
              ) : (
                <ExpandableLeg
                  leg={leg}
                  riding={!!leg.tripId && leg.tripId === ridingTripId}
                  onToggleRiding={onToggleRiding}
                  trafficEstimate={conditions?.legs[i]}
                />
              )}
            </div>
          ))}
          <FareBreakdown fare={fare} locale={locale} t={t} />
        </div>
      )}
    </div>
  )
}
