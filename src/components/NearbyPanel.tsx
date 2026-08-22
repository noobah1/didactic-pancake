'use client'

import { useEffect } from 'react'
import { X, RefreshCw } from 'lucide-react'
import { useGeolocation } from '@/hooks/use-geolocation'
import { useNearbyStops } from '@/hooks/use-nearby-stops'
import { MODE_COLORS } from '@/lib/constants'
import { minutesUntil } from '@/lib/stop-time'
import { useTranslation } from '@/lib/i18n/context'

interface NearbyPanelProps {
  onSelectStop: (name: string, lat: number, lng: number, stopId: string) => void
  onClose: () => void
}

function formatWalkDistance(meters: number, locale: 'en' | 'et' | 'ru'): string {
  const unitM = locale === 'ru' ? 'м' : 'm'
  const unitKm = locale === 'ru' ? 'км' : 'km'
  if (meters < 1000) return `${Math.round(meters)} ${unitM}`
  return `${(meters / 1000).toFixed(1)} ${unitKm}`
}

export function NearbyPanel({ onSelectStop, onClose }: NearbyPanelProps) {
  const { t, locale, modeLabel } = useTranslation()
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
    <div className="absolute bottom-24 right-4 z-40 w-80 max-h-[60vh] bg-white/85 dark:bg-gray-900/80 backdrop-blur-xl rounded-xl shadow-lg flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white shrink-0">
        <span className="text-sm font-semibold">{t('nearby.nearYou')}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={request}
            disabled={geoLoading}
            aria-label={t('nearby.refreshLocation')}
            title={t('nearby.refreshLocation')}
            className="p-1 rounded-full hover:bg-white/20 disabled:opacity-50 shrink-0"
          >
            <RefreshCw size={16} className={geoLoading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('nearby.closeNearby')}
            className="p-1 rounded-full hover:bg-white/20 shrink-0"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex flex-col overflow-y-auto">
        {geoLoading && !position && (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">{t('nearby.findingLocation')}</div>
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
              {t('nearby.tryAgain')}
            </button>
          </div>
        )}

        {position && !data && !error && (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">{t('nearby.loadingStops')}</div>
        )}

        {error && !data && (
          <div className="p-4 text-center text-red-500 dark:text-red-400 text-sm">{t('nearby.couldNotLoadStops')}</div>
        )}

        {data && data.stops.length === 0 && (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
            {data.widened ? t('nearby.nothingScheduled') : t('nearby.noStopsWithin', { distance: formatWalkDistance(data.radiusMeters, locale) })}
          </div>
        )}

        {data && data.widened && data.stops.length > 0 && (
          <div className="px-4 pt-2 text-[11px] text-gray-400 dark:text-gray-500">
            {t('nearby.widenedNotice', { distance: formatWalkDistance(data.radiusMeters, locale) })}
          </div>
        )}

        {data && data.stale && (
          <div className="px-4 pt-2 text-[11px] text-amber-500 dark:text-amber-400">{t('nearby.staleNotice')}</div>
        )}

        {data && data.stops.length > 0 && (
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
        )}
      </div>

      {lastUpdated && (
        <div className="px-3 pb-2 text-[11px] text-gray-400 dark:text-gray-500">
          {t('nearby.updated', { time: new Date(lastUpdated).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) })}
        </div>
      )}
    </div>
  )
}
