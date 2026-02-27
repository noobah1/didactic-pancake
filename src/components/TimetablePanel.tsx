'use client'

import { useEffect, useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { VehiclePosition, TripStopInfo } from '@/lib/types'
import { MODE_COLORS } from '@/lib/constants'

interface TimetablePanelProps {
  vehicle: VehiclePosition
  vehicles?: VehiclePosition[]
  onClose: () => void
}

interface TripStopsResponse {
  tripId: string
  line: string
  mode: string
  stops: TripStopInfo[]
  currentTimeSeconds: number
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

export function TimetablePanel({ vehicle, vehicles, onClose }: TimetablePanelProps) {
  const [stops, setStops] = useState<TripStopInfo[] | null>(null)
  const [matchedTripId, setMatchedTripId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isScheduled = vehicle.id.includes(':')
  const color = MODE_COLORS[vehicle.mode]

  // Get latest position from the vehicles array (updates every 5s)
  const liveVehicle = useMemo(() => {
    if (!vehicles) return null
    return vehicles.find((v) => v.id === vehicle.id) || null
  }, [vehicles, vehicle.id])

  const currentLat = liveVehicle?.lat ?? vehicle.lat
  const currentLng = liveVehicle?.lng ?? vehicle.lng

  // Fetch schedule — match trip once, then reuse tripId for all subsequent fetches
  useEffect(() => {
    let cancelled = false
    let lockedTripId: string | null = null

    const doFetch = (lat: number, lng: number) => {
      let url: string
      if (lockedTripId) {
        // After first match: use locked tripId, just update GPS position
        url = `/api/trip-stops?tripId=${encodeURIComponent(lockedTripId)}&lat=${lat}&lng=${lng}`
      } else if (isScheduled) {
        url = `/api/trip-stops?tripId=${encodeURIComponent(vehicle.id)}&lat=${lat}&lng=${lng}`
      } else {
        url = `/api/trip-stops?line=${encodeURIComponent(vehicle.line)}&mode=${encodeURIComponent(vehicle.mode)}&destination=${encodeURIComponent(vehicle.destination)}&lat=${lat}&lng=${lng}`
      }

      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error('No schedule found')
          return res.json()
        })
        .then((result: TripStopsResponse) => {
          if (!cancelled) {
            setStops(result.stops)
            setLoading(false)
            // Lock in the matched trip so it never flips
            if (!lockedTripId && result.tripId) {
              lockedTripId = result.tripId
              setMatchedTripId(result.tripId)
            }
          }
        })
        .catch((err) => {
          if (!cancelled && !stops) {
            setError(err.message)
            setLoading(false)
          }
        })
    }

    setLoading(true)
    setError(null)
    doFetch(currentLat, currentLng)

    const timer = setInterval(() => {
      // Use latest position from the ref-like values at interval time
      const lv = vehicles?.find((v) => v.id === vehicle.id)
      const lat = lv?.lat ?? vehicle.lat
      const lng = lv?.lng ?? vehicle.lng
      doFetch(lat, lng)
    }, 10_000)

    return () => { cancelled = true; clearInterval(timer) }
  // Only re-run when the vehicle itself changes, NOT on every GPS position update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.id, vehicle.line, vehicle.mode, vehicle.destination, isScheduled])

  const nowSec = getNowSeconds()
  const visibleStops = useMemo(() => stops ? trimStops(stops) : [], [stops])

  // GPS determines which stop is next (based on where the bus actually is)
  const nextStop = stops?.find((s) => s.status === 'upcoming')
  const currentStop = stops?.find((s) => s.status === 'current')

  // Lateness: GPS says bus hasn't reached the stop yet + schedule says it should have (+ 59s buffer)
  // No prediction — just facts: is the bus there or not, and is the time past?
  let arrivalInfo: { minutes: number; late: boolean } | null = null
  if (nextStop) {
    const diff = nextStop.scheduledArrival - nowSec
    if (diff >= -59) {
      // Within 59s buffer = on time
      arrivalInfo = { minutes: Math.max(0, Math.ceil(diff / 60)), late: false }
    } else {
      // GPS shows bus isn't at the stop yet AND more than 59s past schedule = late
      arrivalInfo = { minutes: Math.ceil(Math.abs(diff) / 60), late: true }
    }
  }

  return (
    <div className="absolute bottom-3 left-3 z-30 w-80 max-h-[70vh] bg-white rounded-xl shadow-lg flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 text-white shrink-0"
        style={{ backgroundColor: color }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg font-bold">{vehicle.line}</span>
          <span className="text-sm opacity-90 truncate">&rarr; {vehicle.destination}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-full hover:bg-white/20 transition-colors shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      {/* Next stop arrival banner — hidden when bus is at a station */}
      {arrivalInfo && nextStop && !currentStop && (
        <div className={`px-4 py-2 text-sm font-medium shrink-0 ${arrivalInfo.late && arrivalInfo.minutes > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {arrivalInfo.late && arrivalInfo.minutes > 0 ? (
            <>
              <span className="font-bold">{nextStop.name}</span> &mdash; {arrivalInfo.minutes} min late
            </>
          ) : arrivalInfo.late ? (
            <>
              <span className="font-bold">{nextStop.name}</span> &mdash; on time
            </>
          ) : (
            <>
              <span className="font-bold">{nextStop.name}</span> &mdash; in {arrivalInfo.minutes} min
            </>
          )}
        </div>
      )}
      {currentStop && (
        <div className="px-4 py-2 text-sm font-medium bg-amber-50 text-amber-700 shrink-0">
          At <span className="font-bold">{currentStop.name}</span>
        </div>
      )}

      {/* Content */}
      <div className="overflow-y-auto flex-1">
        {loading && (
          <div className="p-4 text-center text-gray-400 text-sm">Loading timetable...</div>
        )}

        {error && (
          <div className="p-4 text-center text-gray-400 text-sm">{error}</div>
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
                const diff = stop.scheduledArrival - nowSec
                minutesAway = Math.ceil(diff / 60)
              }

              return (
                <div key={`${stop.stopId}-${i}`}>
                  <div
                    className={`flex items-stretch px-4 ${isCurrent ? 'bg-amber-50' : isNextStop ? 'bg-green-50/50' : ''}`}
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
                      <div className={`text-sm leading-tight truncate ${isCurrent || isNextStop ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                        {stop.name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">
                          {formatTime(stop.scheduledArrival)} &rarr; {formatTime(stop.scheduledDeparture)}
                        </span>
                        {isCurrent && (
                          <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">
                            NOW
                          </span>
                        )}
                        {isNextStop && arrivalInfo && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${arrivalInfo.late && arrivalInfo.minutes > 0 ? 'text-red-700 bg-red-100' : 'text-green-700 bg-green-100'}`}>
                            {arrivalInfo.late && arrivalInfo.minutes > 0 ? `${arrivalInfo.minutes} min late` : arrivalInfo.late ? 'on time' : `${arrivalInfo.minutes} min`}
                          </span>
                        )}
                        {!isPassed && !isCurrent && !isNextStop && minutesAway !== null && minutesAway > 0 && (
                          <span className="text-[10px] text-gray-400">
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
      </div>
    </div>
  )
}
