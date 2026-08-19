'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Footprints } from 'lucide-react'
import { TAP_SPRING } from '@/components/AnimatedOverlay'
import { RouteResult, RouteLeg, TransportMode, RouteTrafficEstimate } from '@/lib/types'
import { MODE_COLORS, MODE_LABELS } from '@/lib/constants'
import { ROUTE_PLAN_MATCH_WINDOW_SEC, findVehicleForLeg } from '@/lib/delay'
import { DelayedVehicle } from '@/app/api/delays/route'

// Modes with a live position feed behind them: Tallinn's own for the road
// modes, Elron's for trains (see src/lib/elron.ts). Ferry has none, so a
// ferry leg can only ever show its scheduled time.
const GPS_MODES = new Set<TransportMode>(['bus', 'tram', 'trolleybus', 'nightbus', 'train'])

// Critically damped — these are disclosure toggles the user tapped, not
// flicks, so no overshoot (apple-design skill §4 default UI spring).
const DISCLOSURE_SPRING = { type: 'spring', damping: 1, duration: 0.3 } as const

interface RouteCardProps {
  route: RouteResult
  selected: boolean
  onSelect: () => void
  delayVehicles?: DelayedVehicle[]
  trafficEstimates?: RouteTrafficEstimate[]
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Tallinn' })
}

function ExpandableLeg({ leg }: { leg: RouteLeg }) {
  const [expanded, setExpanded] = useState(false)
  const color = MODE_COLORS[leg.mode as keyof typeof MODE_COLORS] || '#6B7280'
  const stops = leg.intermediateStops || []

  return (
    <div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
        className="w-full flex items-center justify-between py-1.5 text-left"
      >
        <div className="flex items-center gap-2">
          <span
            className="px-1.5 py-0.5 rounded text-xs font-bold text-white"
            style={{ backgroundColor: color }}
          >
            {leg.route || leg.mode}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{formatTime(leg.startTime)}</span>
          <span className="text-xs text-gray-600 dark:text-gray-300">{leg.from.name} &rarr; {leg.to.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400 dark:text-gray-500">{Math.round(leg.duration / 60)} min</span>
          {stops.length > 0 && (
            <svg
              className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
            </svg>
          )}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {expanded && stops.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={DISCLOSURE_SPRING}
            className="overflow-hidden"
          >
            <div className="ml-1 pl-2 border-l-2 mb-1" style={{ borderColor: color }}>
              <div className="flex items-center gap-2 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{formatTime(leg.startTime)}</span>
                <span className="text-xs text-gray-600 dark:text-gray-300">{leg.from.name}</span>
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
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function RouteCard({ route, selected, onSelect, delayVehicles, trafficEstimates }: RouteCardProps) {
  const transitLegs = route.legs.filter((l) => l.mode !== 'walk')
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

  // Falls through only when nothing above found a GPS-confirmed delay —
  // routeGtfsId is unambiguous (unlike leg.route's bare line number, see its
  // own comment in types.ts), so this never risks crediting the wrong
  // operator's same-numbered route with someone else's slowdown.
  const routeEstimate =
    delayMinutes === null
      ? transitLegs
          .map((leg) => trafficEstimates?.find((e) => e.routeGtfsId === leg.routeGtfsId))
          .find((e): e is RouteTrafficEstimate => e != null)
      : undefined

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect() }}
      whileTap={{ scale: 0.98 }}
      transition={TAP_SPRING}
      className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${
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
              <span className="text-xs font-bold">Walk</span>
            </span>
          ) : (
            <>
              {transitLegs.map((leg, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-gray-400 dark:text-gray-500 text-xs">&rarr;</span>}
                  <span
                    className="px-2 py-0.5 rounded text-xs font-bold text-white"
                    style={{ backgroundColor: MODE_COLORS[leg.mode === 'walk' ? 'bus' : leg.mode] }}
                    title={MODE_LABELS[leg.mode === 'walk' ? 'bus' : leg.mode]}
                  >
                    {leg.route || leg.mode}
                  </span>
                </span>
              ))}
              {walkMinutes > 0 && (
                <span
                  className="flex items-center gap-0.5 text-xs text-gray-400 dark:text-gray-500 shrink-0"
                  title="Includes walking"
                >
                  <Footprints size={12} />
                  {walkMinutes}min
                </span>
              )}
            </>
          )}
        </div>
        <span className="font-bold text-sm text-gray-900 dark:text-gray-100">{totalMinutes} min</span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-gray-500 dark:text-gray-400">{startTime} &rarr; {endTime}</span>
        {transitLegs.length > 0 && (
          delayMinutes === null ? (
            routeEstimate ? (
              // Outlined, not solid — visually distinct from the
              // GPS-confirmed amber chip below, same "estimated, not
              // confirmed" honesty rule as MapView's dashed markers for
              // schedule-interpolated vehicles.
              <span
                className="text-xs text-amber-600 dark:text-amber-400 font-medium border border-amber-400 dark:border-amber-600 rounded px-1"
                title={`${routeEstimate.detectorCount} traffic detector${routeEstimate.detectorCount === 1 ? '' : 's'} along this route — not a GPS-confirmed delay`}
              >
                ~{Math.round(routeEstimate.minSeconds / 60)}
                {Math.round(routeEstimate.maxSeconds / 60) > Math.round(routeEstimate.minSeconds / 60)
                  ? `-${Math.round(routeEstimate.maxSeconds / 60)}`
                  : ''}
                min slower
              </span>
            ) : (
              <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">Scheduled</span>
            )
          ) : delayMinutes > 0 ? (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">{delayMinutes}min delay</span>
          ) : (
            <span className="text-xs text-green-600 dark:text-green-400 font-medium">on time</span>
          )
        )}
      </div>
      <AnimatePresence initial={false}>
        {selected && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={DISCLOSURE_SPRING}
            className="overflow-hidden"
          >
            <div className="mt-2 flex flex-col divide-y divide-gray-100 dark:divide-gray-700">
              {route.legs.map((leg, i) => (
                <div key={i}>
                  {leg.mode === 'walk' ? (
                    <div className="flex items-center gap-2 py-1.5 text-xs text-gray-400 dark:text-gray-500">
                      <Footprints size={14} />
                      <span>Walk {Math.round(leg.duration / 60)} min</span>
                    </div>
                  ) : (
                    <ExpandableLeg leg={leg} />
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
