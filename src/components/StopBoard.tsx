'use client'

import { X } from 'lucide-react'
import { useStopBoard } from '@/hooks/use-stop-board'
import { StopDeparture, StopBoardTarget } from '@/lib/types'
import { MODE_COLORS } from '@/lib/constants'
import { minutesUntil, formatClock } from '@/lib/stop-time'
import { formatAgo } from '@/lib/format-ago'
import { useTranslation } from '@/lib/i18n/context'
import { SheetHandle } from './SheetHandle'
import { useResizableSheet } from '@/hooks/use-resizable-sheet'

export type { StopBoardTarget } from '@/lib/types'

// How far the panel can be dragged, in vh — same drag-to-resize pattern as
// RouteResults' journey panel, so a stop with many departures isn't stuck
// scrolling inside a small fixed box. Default matches the previous fixed
// max-h-[40vh] cap.
const MIN_SHEET_VH = 20
const MAX_SHEET_VH = 75
const DEFAULT_SHEET_VH = 40

interface StopBoardProps {
  stop: StopBoardTarget
  onClose: () => void
  onSelectDeparture: (departure: StopDeparture) => void
}

export function StopBoard({ stop, onClose, onSelectDeparture }: StopBoardProps) {
  const { t, locale } = useTranslation()
  const { data, error, lastUpdated, stale, staleSince } = useStopBoard(stop.stopId)
  const { heightVh: sheetHeightVh, resize: resizeSheet } = useResizableSheet(DEFAULT_SHEET_VH, MIN_SHEET_VH, MAX_SHEET_VH)

  return (
    <div
      className={`flex flex-col bg-white/85 dark:bg-gray-900/80 backdrop-blur-xl rounded-xl shadow-lg mt-2 ${sheetHeightVh === null ? 'max-h-[40vh] sm:max-h-[24rem]' : 'sm:max-h-[24rem]'}`}
      style={sheetHeightVh !== null ? { maxHeight: `${sheetHeightVh}vh` } : undefined}
    >
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
          aria-label={t('stopBoard.closeBoard')}
          className="shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <X size={16} />
        </button>
      </div>

      {!data && !error && (
        <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">{t('stopBoard.loadingDepartures')}</div>
      )}

      {error && !data && (
        <div className="p-4 text-center text-red-500 dark:text-red-400 text-sm">{t('stopBoard.couldNotLoadDepartures')}</div>
      )}

      {data && data.departures.length === 0 && (
        <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">{t('stopBoard.noUpcomingDepartures')}</div>
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
                className="flex items-center gap-2.5 px-1.5 py-2 rounded-lg text-left hover:bg-gray-50 dark:hover:bg-gray-700"
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
                {dep.platform && (
                  <span
                    title={dep.platformChanged ? t('route.platformChanged') : undefined}
                    className={`shrink-0 px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                      dep.platformChanged
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {t('route.platformShort', { n: dep.platform })}
                  </span>
                )}
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-medium text-gray-900 dark:text-gray-50">
                    {mins <= 0 ? t('common.now') : t('common.minShort', { n: mins })}
                  </span>
                  <span className="block text-[11px] text-gray-400 dark:text-gray-500">{formatClock(dep.departureEpochSec)}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {stale && staleSince ? (
        <div className="px-3 pb-2 text-[11px] text-amber-600 dark:text-amber-400">
          {t('stopBoard.lastKnownOffline', { ago: formatAgo(new Date().getTime() - staleSince, locale) })}
        </div>
      ) : (
        lastUpdated && (
          <div className="px-3 pb-2 text-[11px] text-gray-400 dark:text-gray-500">
            {t('stopBoard.updated', { time: new Date(lastUpdated).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) })}
          </div>
        )
      )}

      {/* Anchored to the top (unlike RouteResults' bottom sheet), so the
          panel grows downward — the handle sits at the bottom edge. */}
      <SheetHandle
        heightVh={sheetHeightVh ?? DEFAULT_SHEET_VH}
        minVh={MIN_SHEET_VH}
        maxVh={MAX_SHEET_VH}
        onResize={resizeSheet}
        direction="grow-down"
        label={t('stopBoard.resizePanel')}
      />
    </div>
  )
}
