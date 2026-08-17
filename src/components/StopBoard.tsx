'use client'

import { X } from 'lucide-react'
import { useStopBoard } from '@/hooks/use-stop-board'
import { StopDeparture } from '@/lib/types'
import { MODE_COLORS } from '@/lib/constants'

export interface StopBoardTarget {
  stopId: string
  name: string
  lat: number
  lng: number
}

interface StopBoardProps {
  stop: StopBoardTarget
  onClose: () => void
  onSelectDeparture: (departure: StopDeparture) => void
}

function minutesUntil(epochSec: number): number {
  return Math.round((epochSec * 1000 - Date.now()) / 60_000)
}

function formatClock(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function StopBoard({ stop, onClose, onSelectDeparture }: StopBoardProps) {
  const { data, error, lastUpdated } = useStopBoard(stop.stopId)

  return (
    <div className="flex flex-col bg-white dark:bg-gray-800 rounded-xl shadow-lg mt-2 max-h-[40vh] sm:max-h-[24rem]">
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 truncate pr-2">
          {/* The stop-search result carries a "(Bus stop)"-style suffix that's
              useful for disambiguating in the dropdown but redundant once
              this is the only stop on screen. */}
          {stop.name.replace(/\s*\([^)]+\)\s*$/, '')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close departure board"
          className="shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {!data && !error && (
        <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">Loading departures...</div>
      )}

      {error && !data && (
        <div className="p-4 text-center text-red-500 dark:text-red-400 text-sm">Couldn&apos;t load departures</div>
      )}

      {data && data.departures.length === 0 && (
        <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">No upcoming departures</div>
      )}

      {data && data.departures.length > 0 && (
        <div className="flex flex-col overflow-y-auto px-2 pb-2">
          {data.departures.map((dep, i) => {
            const mins = minutesUntil(dep.departureEpochSec)
            return (
              <button
                key={`${dep.tripId}-${i}`}
                type="button"
                onClick={() => onSelectDeparture(dep)}
                className="flex items-center gap-2.5 px-1.5 py-2 rounded-lg text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <span
                  className="shrink-0 min-w-[1.75rem] px-1.5 py-0.5 rounded text-white text-xs font-bold text-center"
                  style={{ backgroundColor: MODE_COLORS[dep.mode] }}
                >
                  {dep.line}
                </span>
                <span className="flex-1 min-w-0 truncate text-sm text-gray-800 dark:text-gray-100">
                  {dep.headsign}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-medium text-gray-900 dark:text-gray-50">
                    {mins <= 0 ? 'now' : `${mins} min`}
                  </span>
                  <span className="block text-[11px] text-gray-400 dark:text-gray-500">{formatClock(dep.departureEpochSec)}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {lastUpdated && (
        <div className="px-3 pb-2 text-[11px] text-gray-400 dark:text-gray-500">
          Updated {new Date(lastUpdated).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  )
}
