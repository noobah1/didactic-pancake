'use client'

import { RouteLeg } from '@/lib/types'
import { RidingProgress } from '@/lib/riding-progress'
import { MODE_COLORS } from '@/lib/constants'
import { useTranslation } from '@/lib/i18n/context'

interface RidingPanelProps {
  leg: RouteLeg
  progress: RidingProgress | null
  error: string | null
  onStop: () => void
}

// The active "I'm on this" session — see use-riding-mode.ts, which this
// purely renders. Kept as a single persistent banner (not per-warning like
// DelayBanner) since there is exactly one riding session at a time.
export function RidingPanel({ leg, progress, error, onStop }: RidingPanelProps) {
  const { t } = useTranslation()
  const color = MODE_COLORS[leg.mode as keyof typeof MODE_COLORS] || '#6B7280'

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="shrink-0 px-1.5 py-0.5 rounded text-xs font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {leg.route || leg.mode}
        </span>
        {error ? (
          <span className="text-red-600 dark:text-red-400 font-medium truncate">{error}</span>
        ) : progress ? (
          <span className="flex items-center gap-1.5 min-w-0">
            {progress.shouldAlarm && (
              <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 font-semibold">
                {t('riding.arriving')}
              </span>
            )}
            <span className="text-gray-700 dark:text-gray-300 truncate">
              {t('riding.nextStop', { name: progress.nextStop.name })}
            </span>
            <span className="shrink-0 text-gray-400 dark:text-gray-500">
              {t('riding.stopsToGo', { n: progress.stopsRemaining, plural: progress.stopsRemaining === 1 ? '' : 's' })}
            </span>
          </span>
        ) : (
          <span className="text-gray-400 dark:text-gray-500">{t('common.loading')}</span>
        )}
      </div>
      <button
        type="button"
        onClick={onStop}
        className="shrink-0 px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded font-medium hover:bg-gray-200 dark:hover:bg-gray-600"
      >
        {t('riding.stopRiding')}
      </button>
    </div>
  )
}
