'use client'

import { Star, X } from 'lucide-react'
import { FavoriteRoute } from '@/lib/types'
import { useTranslation } from '@/lib/i18n/context'
import { useFavoriteDeparture } from '@/hooks/use-favorite-departure'
import { formatAgo } from '@/lib/format-ago'
import { MODE_COLORS } from '@/lib/constants'

interface FavoriteChipProps {
  favorite: FavoriteRoute
  onSelect: () => void
  onRemove: () => void
}

export function FavoriteChip({ favorite, onSelect, onRemove }: FavoriteChipProps) {
  const { t, locale } = useTranslation()
  // Never live -- there's no background polling per favorite (see
  // use-favorite-departure.ts), so this is always a snapshot of whatever
  // the rider last actually searched for this trip, however old.
  const cachedDeparture = useFavoriteDeparture(favorite.id)

  return (
    <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-2xl shadow-md pl-3 pr-1 py-1.5">
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-col items-start gap-0.5 text-xs text-gray-700 dark:text-gray-200 hover:text-blue-700 dark:hover:text-blue-400"
      >
        <span className="flex items-center gap-1">
          <Star size={12} fill="#F59E0B" stroke="#F59E0B" />
          <span className="max-w-[10rem] truncate">{favorite.fromName}</span>
          <span className="text-gray-400">&rarr;</span>
          <span className="max-w-[10rem] truncate">{favorite.toName}</span>
        </span>
        {cachedDeparture && (
          <span className="flex items-center gap-1 pl-4 text-[11px] text-gray-400 dark:text-gray-500">
            <span
              className="shrink-0 px-1 rounded text-white font-bold"
              style={{ backgroundColor: MODE_COLORS[cachedDeparture.departure.mode] }}
            >
              {cachedDeparture.departure.line}
            </span>
            <span>
              {new Date(cachedDeparture.departure.startTime).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
              })}
              {' · '}
              {t('favorite.lastKnown', { ago: formatAgo(new Date().getTime() - cachedDeparture.cachedAt, locale) })}
            </span>
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('favorite.removeAria', { from: favorite.fromName, to: favorite.toName })}
        className="p-0.5 rounded-full text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
      >
        <X size={12} />
      </button>
    </div>
  )
}
