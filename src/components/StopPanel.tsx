'use client'

import { useState, useCallback, useMemo } from 'react'
import { X, Accessibility } from 'lucide-react'
import { StopInfo, StopDeparture } from '@/lib/types'
import { MODE_COLORS } from '@/lib/constants'
import { usePolling } from '@/hooks/use-polling'

interface StopPanelProps {
  stop: StopInfo
  onClose: () => void
  onSelectDeparture: (departure: StopDeparture) => void
}

interface DeparturesResponse {
  stop: StopInfo
  departures: StopDeparture[]
  stale?: boolean
  error?: string
}

const POLL_INTERVAL = 20_000

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Tallinn',
  })
}

export function StopPanel({ stop, onClose, onSelectDeparture }: StopPanelProps) {
  const [expanded, setExpanded] = useState(true)

  const fetcher = useCallback(async (): Promise<DeparturesResponse> => {
    const res = await fetch(`/api/stop-departures?stopId=${encodeURIComponent(stop.stopId)}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Failed to fetch departures')
    }
    return res.json()
  }, [stop.stopId])

  const { data, error } = usePolling(fetcher, POLL_INTERVAL)

  const departures = useMemo(() => data?.departures || [], [data])
  const wheelchairAccessible = data?.stop.wheelchairBoarding === 'POSSIBLE'

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50 w-80 max-h-[70vh] bg-white rounded-xl shadow-lg flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 text-white shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold truncate">{stop.name}</span>
          {wheelchairAccessible && (
            <Accessibility size={14} className="shrink-0 text-white/80" aria-label="Wheelchair accessible" />
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label="Expand/Collapse"
            className="p-1 rounded-full hover:bg-white/20 transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 text-white transition-transform ${expanded ? '' : 'rotate-180'}`}
              fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-white/20 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div
        className={`overflow-hidden transition-all duration-200 ${expanded ? 'max-h-[70vh]' : 'max-h-0'}`}
      >
        <div className="overflow-y-auto">
          {!data && !error && (
            <div className="p-4 text-center text-gray-400 text-sm">Loading departures...</div>
          )}

          {error && !data && (
            <div className="p-4 text-center text-gray-400 text-sm">{error.message}</div>
          )}

          {data && departures.length === 0 && (
            <div className="p-4 text-center text-gray-400 text-sm">No upcoming departures</div>
          )}

          {departures.length > 0 && (
            <div className="py-1">
              {departures.map((dep, i) => {
                const color = MODE_COLORS[dep.mode]
                const minutes = Math.round((dep.departure - new Date().getTime()) / 60_000)
                const isLate = dep.realtime && dep.delaySeconds > 59

                return (
                  <button
                    key={`${dep.tripId}-${i}`}
                    type="button"
                    onClick={() => onSelectDeparture(dep)}
                    className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-50 transition-colors"
                  >
                    <span
                      className="shrink-0 min-w-[28px] px-1.5 py-0.5 rounded text-xs font-bold text-white text-center"
                      style={{ backgroundColor: color }}
                    >
                      {dep.line}
                    </span>
                    <span className="flex-1 min-w-0 text-sm text-gray-700 truncate">{dep.headsign}</span>
                    <span className="shrink-0 flex flex-col items-end">
                      <span className={`text-xs font-semibold ${isLate ? 'text-red-600' : 'text-gray-900'}`}>
                        {minutes <= 0 ? 'now' : minutes < 60 ? `${minutes} min` : formatClock(dep.departure)}
                      </span>
                      {isLate && (
                        <span className="text-[10px] text-red-500">
                          +{Math.round(dep.delaySeconds / 60)} min
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
