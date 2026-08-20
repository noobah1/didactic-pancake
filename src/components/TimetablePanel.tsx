'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { X } from 'lucide-react'
import { VehiclePosition, TripStopInfo } from '@/lib/types'
import { MODE_COLORS } from '@/lib/constants'
import { LATE_BUFFER_SEC } from '@/lib/delay'

interface TimetablePanelProps {
  vehicle: VehiclePosition
  vehicles?: VehiclePosition[]
  onClose: () => void
  // Reports the live "is this vehicle currently late" status as it's
  // learned/updated from each poll, so callers (e.g. the map's red route
  // highlight) can track the real-time status instead of freezing whatever
  // was true at the moment the vehicle was selected.
  onLateChange?: (late: boolean) => void
  // When the selection came from somewhere that already knows this
  // vehicle's trip (e.g. the delay board), pass it here so this panel's
  // very first fetch is hinted instead of running an entirely independent,
  // unhinted line/mode/GPS match — which, under real ambiguity, frequently
  // lands on a different trip than the one that opened it, showing a
  // different delay number for what's supposed to be the same vehicle.
  initialTripId?: string | null
}

interface TripStopsResponse {
  tripId: string
  line: string
  mode: string
  stops: TripStopInfo[]
  currentTimeSeconds: number
  delaySeconds?: number // absent = no live GPS evidence
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

function getNowSeconds(): number {
  const now = new Date()
  const parts = now.toLocaleTimeString('en-GB', { timeZone: 'Europe/Tallinn', hour12: false }).split(':')
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
}

function trimStops(stops: TripStopInfo[]): TripStopInfo[] {
  let lastPassedIdx = -1
  for (let i = stops.length - 1; i >= 0; i--) {
    if (stops[i].status === 'passed') {
      lastPassedIdx = i
      break
    }
  }
  const from = Math.max(0, lastPassedIdx - 1)
  return stops.slice(from)
}

export function TimetablePanel({ vehicle, vehicles, onClose, onLateChange, initialTripId }: TimetablePanelProps) {
  const [expanded, setExpanded] = useState(true)
  const [showAllStops, setShowAllStops] = useState(false)
  const [stops, setStops] = useState<TripStopInfo[] | null>(null)
  const [delaySeconds, setDelaySeconds] = useState<number | undefined>(undefined)
  const [matchedTripId, setMatchedTripId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // An id carrying a feed prefix is an OTP trip gtfsId, so the trip is known
  // outright and needs no matching. That covers both schedule-interpolated
  // vehicles and Elron trains, whose live feed names the trip it's running —
  // so "which trip" and "is the position real" are two separate questions.
  const isKnownTrip = vehicle.id.includes(':')
  const hasLiveGps = !vehicle.estimated
  const color = MODE_COLORS[vehicle.mode]

  // Ref so the interval always reads the latest vehicles array
  const vehiclesRef = useRef(vehicles)
  vehiclesRef.current = vehicles

  const currentLat = vehicle.lat
  const currentLng = vehicle.lng

  // Fetch schedule — match trip once, then reuse tripId for all subsequent fetches
  useEffect(() => {
    let cancelled = false
    // Seeded from the caller's hint (e.g. the delay board's own match) so
    // even the very first fetch is biased toward the same trip, not just
    // subsequent ones.
    let lockedTripId: string | null = initialTripId ?? null
    let isFirstFetch = true

    const doFetch = (lat: number, lng: number) => {
      let url: string
      if (isKnownTrip) {
        // The id itself is already the exact trip, so once locked, keep using
        // that same id directly — no matching ambiguity here at all. Flag a
        // real GPS position so a live train gets a confirmed delay off it
        // rather than the time-based fallback used for interpolated ones.
        const tripIdToUse = lockedTripId || vehicle.id
        url = `/api/trip-stops?tripId=${encodeURIComponent(tripIdToUse)}&lat=${lat}&lng=${lng}`
        if (hasLiveGps) url += '&live=1'
      } else {
        // Live GPS vehicles: always re-match by line/mode/GPS (this is the
        // only method that can compute a real GPS-based delay — a locked
        // tripId lookup never does), but once a trip has matched once, pass
        // it as a *preference* so findBestTrip's continuity bonus keeps
        // picking the same trip run to run, exactly like /api/delays does
        // for its own polling. Without this, this panel and the delay board
        // ran two completely independent, unstable matches for the same
        // physical vehicle — each poll re-guessing from scratch — and could
        // land on two different trips with two different delay numbers for
        // what's actually the same bus.
        url = `/api/trip-stops?line=${encodeURIComponent(vehicle.line)}&mode=${encodeURIComponent(vehicle.mode)}&destination=${encodeURIComponent(vehicle.destination)}&lat=${lat}&lng=${lng}&heading=${vehicle.heading}`
        if (lockedTripId) {
          url += `&preferredTripId=${encodeURIComponent(lockedTripId)}`
        }
      }

      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error('No schedule found')
          return res.json()
        })
        .then((result: TripStopsResponse) => {
          if (!cancelled) {
            setStops(result.stops)
            setDelaySeconds(result.delaySeconds)
            setLoading(false)
            setError(null)
            // Lock in the matched trip so it never flips
            if (!lockedTripId && result.tripId) {
              lockedTripId = result.tripId
              setMatchedTripId(result.tripId)
            }
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setStops((prev) => {
              if (!prev && isFirstFetch) setError(err.message)
              return prev
            })
            setLoading(false)
          }
        })
        .finally(() => { isFirstFetch = false })
    }

    setLoading(true)
    setError(null)
    doFetch(currentLat, currentLng)

    const timer = setInterval(() => {
      const lv = vehiclesRef.current?.find((v) => v.id === vehicle.id)
      const lat = lv?.lat ?? vehicle.lat
      const lng = lv?.lng ?? vehicle.lng
      doFetch(lat, lng)
    }, 10_000)

    return () => { cancelled = true; clearInterval(timer) }
  // Only re-run when the vehicle itself changes, NOT on every GPS position update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.id, vehicle.line, vehicle.mode, vehicle.destination, isKnownTrip, hasLiveGps, initialTripId])

  // Tick every 15s to keep displayed times current
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  // Keep the caller's "is this vehicle late" status in sync with each live
  // poll — without this, a caller that only reads the status once at
  // selection time (e.g. to decide whether to draw the map route red) would
  // keep showing "late" forever even after this panel's own data shows the
  // vehicle back on schedule.
  useEffect(() => {
    onLateChange?.(delaySeconds != null && delaySeconds >= LATE_BUFFER_SEC)
  }, [delaySeconds, onLateChange])

  const nowSec = getNowSeconds()
  const trimmedStops = useMemo(() => stops ? trimStops(stops) : [], [stops])

  // GPS determines which stop is next (based on where the bus actually is)
  const nextStop = stops?.find((s) => s.status === 'upcoming')
  const currentStop = stops?.find((s) => s.status === 'current')

  // Compact view: up to 5 stops centered on where the bus is now. Full route is opt-in.
  const compactStops = useMemo(() => {
    if (trimmedStops.length <= 5) return trimmedStops
    const anchorIdx = trimmedStops.findIndex((s) => s.status === 'current' || s.status === 'upcoming')
    if (anchorIdx === -1) return trimmedStops.slice(-5)
    const start = Math.max(0, Math.min(anchorIdx - 1, trimmedStops.length - 5))
    return trimmedStops.slice(start, start + 5)
  }, [trimmedStops])
  const visibleStops = showAllStops ? trimmedStops : compactStops

  // scheduledArrival is always the true published schedule (never shifted) —
  // add delaySeconds back in explicitly to get the live ETA. Lateness itself
  // comes straight from the server's delaySeconds (GPS position vs original
  // schedule), not from re-deriving it by comparing times.
  let arrivalInfo: { minutes: number; late: boolean; hasLiveData: boolean } | null = null
  if (nextStop) {
    const etaMinutes = Math.max(0, Math.ceil((nextStop.scheduledArrival + (delaySeconds ?? 0) - nowSec) / 60))
    if (delaySeconds != null && delaySeconds >= LATE_BUFFER_SEC) {
      arrivalInfo = { minutes: Math.round(delaySeconds / 60), late: true, hasLiveData: true }
    } else {
      arrivalInfo = { minutes: etaMinutes, late: false, hasLiveData: delaySeconds != null }
    }
  }

  // Only surface a headline when something's actually wrong — on-time/arriving
  // is the default expectation and doesn't need announcing.
  const headline =
    !currentStop && nextStop && arrivalInfo?.late && arrivalInfo.minutes > 0
      ? { text: `${arrivalInfo.minutes} min late` }
      : null

  return (
    <div
      className="absolute bottom-3 left-3 z-50 w-64 max-h-[38vh] sm:max-h-[55vh] bg-white/85 dark:bg-gray-900/80 backdrop-blur-xl rounded-xl shadow-lg flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 text-white shrink-0"
        style={{ backgroundColor: color }}
      >
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-lg font-bold">{vehicle.line}</span>
          <span className="text-sm opacity-90 truncate">&rarr; {vehicle.destination}</span>
        </div>
        <div className="flex items-center gap-5 min-w-0">
          {/* The expand/collapse button */}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label="Expand/Collapse"
            className="p-1 rounded-full hover:bg-white/20 transition-colors shrink-0"
          >
            <svg
              className={`w-3.5 h-3.5 text-white transition-transform ${expanded ? '' : 'rotate-180'}`}
              fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full hover:bg-white/20 transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* expanding-contracting */}
      <div
        className={`flex flex-col overflow-hidden transition-all duration-200 ${
          expanded ? 'max-h-[70vh]' : 'max-h-0'
        }`}
      >
      
        {/* Delay status — compact, at the top, no repeated "At X" text */}
        {!loading && !error && headline && (
          <div className="px-4 pt-3 pb-1 text-sm font-semibold shrink-0 text-red-600 dark:text-red-400">
            {headline.text}
          </div>
        )}

        {/* Collapse back to 5 stops without scrolling past the full list first */}
        {!loading && !error && showAllStops && trimmedStops.length > compactStops.length && (
          <button
            type="button"
            onClick={() => setShowAllStops(false)}
            className="mx-4 mb-1 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 shrink-0 text-left"
          >
            Show fewer stops
          </button>
        )}

        {/* Content */}
        <div className="overflow-y-auto flex-1">
          {loading && (
            <div className="p-4 text-center text-gray-400 dark:text-gray-500 text-sm">Loading timetable...</div>
          )}

          {error && (
            <div className="p-4 text-center text-gray-400 dark:text-gray-500 text-sm">{error}</div>
          )}

          {!loading && !error && visibleStops.length > 0 && (
            <div className="py-2">
              {visibleStops.map((stop, i) => {
                const isCurrent = stop.status === 'current'
                const isPassed = stop.status === 'passed'
                const isFirst = i === 0
                const isLast = i === visibleStops.length - 1
                const isNextStop = nextStop && stop.stopId === nextStop.stopId && stop.scheduledArrival === nextStop.scheduledArrival

                let minutesAway: number | null = null
                if (stop.status === 'upcoming') {
                  const diff = stop.scheduledArrival + (stop.delaySeconds ?? 0) - nowSec
                  minutesAway = Math.ceil(diff / 60)
                }

                return (
                  <div key={`${stop.stopId}-${i}`}>
                    <div
                      className={`flex items-stretch px-4 ${isCurrent ? 'bg-amber-50 dark:bg-amber-950' : isNextStop ? 'bg-green-50/50 dark:bg-green-950/50' : ''}`}
                    >
                      {/* Timeline */}
                      <div className="flex flex-col items-center w-5 shrink-0 mr-3">
                        {!isFirst && (
                          <div
                            className="w-0.5 flex-1"
                            style={{ backgroundColor: isPassed || isCurrent ? '#D1D5DB' : color }}
                          />
                        )}
                        <div
                          className="shrink-0 rounded-full border-2"
                          style={{
                            width: isCurrent || isNextStop ? 14 : 10,
                            height: isCurrent || isNextStop ? 14 : 10,
                            backgroundColor: isCurrent ? '#FCD34D' : isPassed ? '#D1D5DB' : isNextStop ? '#BBF7D0' : '#fff',
                            borderColor: isCurrent ? '#F59E0B' : isPassed ? '#9CA3AF' : isNextStop ? '#16A34A' : color,
                          }}
                        />
                        {!isLast && (
                          <div
                            className="w-0.5 flex-1"
                            style={{ backgroundColor: isPassed ? '#D1D5DB' : color }}
                          />
                        )}
                      </div>

                      {/* Stop info */}
                      <div className={`flex-1 py-2 min-w-0 ${isPassed ? 'opacity-50' : ''}`}>
                        <div className={`text-sm leading-tight truncate ${isCurrent || isNextStop ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}>
                          {stop.name}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {formatTime(stop.scheduledArrival)}
                          </span>
                          {isCurrent && (
                            <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-300 bg-amber-100 dark:bg-amber-900 px-1.5 py-0.5 rounded">
                              NOW
                            </span>
                          )}
                          {isNextStop && arrivalInfo && (
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                arrivalInfo.late
                                  ? 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900'
                                  : arrivalInfo.hasLiveData
                                    ? 'text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900'
                                    : 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700'
                              }`}
                            >
                              {arrivalInfo.late ? `${arrivalInfo.minutes} min late` : `${arrivalInfo.minutes} min`}
                            </span>
                          )}
                          {!isPassed && !isCurrent && !isNextStop && minutesAway !== null && minutesAway > 0 && (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">
                              {minutesAway} min
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                  </div>
                )
              })}
            </div>
          )}

          {!loading && !error && trimmedStops.length > compactStops.length && (
            <button
              type="button"
              onClick={() => setShowAllStops(!showAllStops)}
              className="w-full py-2 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 border-t border-gray-100 dark:border-gray-700"
            >
              {showAllStops ? 'Show less' : `Show full route (${trimmedStops.length} stops)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

