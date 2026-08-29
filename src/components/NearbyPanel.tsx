'use client'

import { useEffect } from 'react'
import { X, RefreshCw } from 'lucide-react'
import { useGeolocation } from '@/hooks/use-geolocation'
import { useNearbyStops } from '@/hooks/use-nearby-stops'
import { useTranslation } from '@/lib/i18n/context'
import { NearbyStopList, formatWalkDistance } from './NearbyStopList'

interface NearbyPanelProps {
  onSelectStop: (name: string, lat: number, lng: number, stopId: string) => void
  onClose: () => void
}

export function NearbyPanel({ onSelectStop, onClose }: NearbyPanelProps) {
  const { t, locale } = useTranslation()
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
          <NearbyStopList data={data} onSelectStop={onSelectStop} />
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
