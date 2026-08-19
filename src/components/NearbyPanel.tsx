'use client'

import { useEffect } from 'react'
import { X, RefreshCw } from 'lucide-react'
import { useGeolocation } from '@/hooks/use-geolocation'
import { useNearbyStops } from '@/hooks/use-nearby-stops'
import { MODE_COLORS, MODE_LABELS } from '@/lib/constants'
import { minutesUntil } from '@/lib/stop-time'

interface NearbyPanelProps {
  onSelectStop: (name: string, lat: number, lng: number, stopId: string) => void
  onClose: () => void
}

function formatWalkDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

export function NearbyPanel({ onSelectStop, onClose }: NearbyPanelProps) {
  const { position, error: geoError, loading: geoLoading, request } = useGeolocation()
  const { data, error, lastUpdated } = useNearbyStops(position)

  // Panel mounts on open (page.tsx renders it conditionally), so requesting
  // once here is the one-shot fix — a manual refresh re-requests via the
  // header button below, never an automatic watch.
  useEffect(() => {
    request()
    // Only ever fire on mount, not on every `request` identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="absolute bottom-24 right-4 z-40 w-80 max-h-[60vh] bg-white dark:bg-gray-800 rounded-xl shadow-lg flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white shrink-0">
        <span className="text-sm font-semibold">Near you</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={request}
            disabled={geoLoading}
            aria-label="Refresh location"
            title="Refresh location"
            className="p-1 rounded-full hover:bg-white/20 disabled:opacity-50 transition-colors shrink-0"
          >
            <RefreshCw size={16} className={geoLoading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close nearby stops"
            className="p-1 rounded-full hover:bg-white/20 transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex flex-col overflow-y-auto">
        {geoLoading && !position && (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">Finding your location...</div>
        )}

        {geoError && (
          <div className="p-4 flex flex-col items-center gap-2">
            <p className="w-full px-3 py-1.5 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 text-xs rounded-lg border border-red-200 dark:border-red-800 text-center">
              {geoError}
            </p>
            <button
              type="button"
              onClick={request}
              className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {position && !data && !error && (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">Loading nearby stops...</div>
        )}

        {error && !data && (
          <div className="p-4 text-center text-red-500 dark:text-red-400 text-sm">Couldn&apos;t load nearby stops</div>
        )}

        {data && data.stops.length === 0 && (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
            {data.widened ? 'Nothing scheduled from stops near you right now' : `No stops within ${formatWalkDistance(data.radiusMeters)}`}
          </div>
        )}

        {data && data.widened && data.stops.length > 0 && (
          <div className="px-4 pt-2 text-[11px] text-gray-400 dark:text-gray-500">
            Nothing nearby — showing stops up to {formatWalkDistance(data.radiusMeters)} away
          </div>
        )}

        {data && data.stale && (
          <div className="px-4 pt-2 text-[11px] text-amber-500 dark:text-amber-400">Showing last known departures</div>
        )}

        {data && data.stops.length > 0 && (
          <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-700 px-2 pb-2">
            {data.stops.map((stop) => (
              <div key={stop.stopId} className="pt-1">
                <button
                  type="button"
                  onClick={() => onSelectStop(stop.name, stop.lat, stop.lng, stop.stopId)}
                  className="w-full flex items-center justify-between gap-2 px-1.5 py-1.5 rounded-lg text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {stop.name}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                    {formatWalkDistance(stop.distanceMeters)}
                  </span>
                </button>
                <div className="flex flex-col pb-1.5">
                  {stop.departures.slice(0, 3).map((dep, i) => {
                    const mins = minutesUntil(dep.departureEpochSec)
                    return (
                      <div
                        key={`${dep.tripId}-${dep.departureEpochSec}-${i}`}
                        className="flex items-center gap-2 px-1.5 py-0.5"
                      >
                        <span
                          className="shrink-0 min-w-[1.75rem] px-1.5 py-0.5 rounded text-white text-xs font-bold text-center"
                          style={{ backgroundColor: MODE_COLORS[dep.mode] }}
                          title={MODE_LABELS[dep.mode]}
                        >
                          {dep.line}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-xs text-gray-600 dark:text-gray-300">
                          {dep.headsign}
                        </span>
                        <span className="shrink-0 text-xs font-medium text-gray-900 dark:text-gray-100">
                          {mins <= 0 ? 'now' : `${mins} min`}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {lastUpdated && (
        <div className="px-3 pb-2 text-[11px] text-gray-400 dark:text-gray-500">
          Updated {new Date(lastUpdated).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  )
}
