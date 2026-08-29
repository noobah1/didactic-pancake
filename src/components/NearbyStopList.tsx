'use client'

import { NearbyStopsData } from '@/lib/types'
import { MODE_COLORS } from '@/lib/constants'
import { minutesUntil } from '@/lib/stop-time'
import { useTranslation } from '@/lib/i18n/context'

// Shared by NearbyPanel (geolocation-anchored) and PlaceStopsPanel
// (accommodation-anchored) — both feed the same NearbyStopsData shape into
// the same stop/departure list, so the rendering lives in exactly one place
// rather than drifting between two copies.
export function formatWalkDistance(meters: number, locale: 'en' | 'et' | 'ru'): string {
  const unitM = locale === 'ru' ? 'м' : 'm'
  const unitKm = locale === 'ru' ? 'км' : 'km'
  if (meters < 1000) return `${Math.round(meters)} ${unitM}`
  return `${(meters / 1000).toFixed(1)} ${unitKm}`
}

interface NearbyStopListProps {
  data: NearbyStopsData
  onSelectStop: (name: string, lat: number, lng: number, stopId: string) => void
}

export function NearbyStopList({ data, onSelectStop }: NearbyStopListProps) {
  const { t, locale, modeLabel } = useTranslation()

  if (data.stops.length === 0) return null

  return (
    <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-700 px-2 pb-2">
      {data.stops.map((stop) => (
        <div key={stop.stopId} className="pt-1">
          <button
            type="button"
            onClick={() => onSelectStop(stop.name, stop.lat, stop.lng, stop.stopId)}
            className="w-full flex items-center justify-between gap-2 px-1.5 py-1.5 rounded-lg text-left hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {stop.name}
            </span>
            <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
              {formatWalkDistance(stop.distanceMeters, locale)}
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
                    title={modeLabel(dep.mode)}
                  >
                    {dep.line}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-xs text-gray-600 dark:text-gray-300">
                    {dep.headsign}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-gray-900 dark:text-gray-100">
                    {mins <= 0 ? t('common.now') : t('common.minShort', { n: mins })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
