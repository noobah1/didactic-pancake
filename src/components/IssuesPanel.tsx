'use client'

import { useState } from 'react'
import { X, Navigation, ChevronRight, ChevronLeft, ArrowLeft, AlertCircle } from 'lucide-react'
import { MODE_COLORS, MODE_LABELS } from '@/lib/constants'
import { OVERVIEW_THRESHOLD_SEC } from '@/lib/delay'
import { DelayedVehicle } from '@/app/api/delays/route'
import { ServiceAlert, RouteTrafficEstimate } from '@/lib/types'
import { FeedStatus } from '@/lib/feed-status'

interface IssuesPanelProps {
  vehicles: DelayedVehicle[]
  alerts: ServiceAlert[]
  // Road-speed-inferred slowdowns (see RouteTrafficEstimate) — a distinct,
  // lower-confidence signal from `vehicles`, kept in its own section below
  // rather than merged in, same "never conflate GPS-confirmed with inferred"
  // rule the rest of this app follows.
  trafficEstimates: RouteTrafficEstimate[]
  delayStatus: FeedStatus
  alertStatus: FeedStatus
  onSelectVehicle: (vehicle: DelayedVehicle) => void
  // Flies the map to a disruption's real location — reading "Nelgi tee:
  // construction" in a list tells you the road's name, not where it is.
  onLocateAlert?: (alert: ServiceAlert) => void
  onClose: () => void
}

export function IssuesPanel({
  vehicles,
  alerts,
  trafficEstimates,
  delayStatus,
  alertStatus,
  onSelectVehicle,
  onLocateAlert,
  onClose,
}: IssuesPanelProps) {
  // Clicking a disruption swaps the whole list for a single full-detail view
  // (prev/next to browse) instead of expanding in place — with dozens of
  // Tark Tee disruptions, an inline accordion still left every other row
  // visible underneath, which is exactly the "big mess" this avoids.
  // Tracked by id, not array position — alerts re-poll and can reorder
  // (Tark Tee's own ordering isn't guaranteed stable between fetches) while
  // this panel is sitting open, and a raw index would silently start
  // showing a completely different disruption underneath the user.
  const [viewingAlertId, setViewingAlertId] = useState<string | null>(null)
  const delayedVehicles = vehicles
    .filter((v) => v.delaySeconds >= OVERVIEW_THRESHOLD_SEC)
    .sort((a, b) => b.delaySeconds - a.delaySeconds)
  const sortedEstimates = [...trafficEstimates].sort((a, b) => b.maxSeconds - a.maxSeconds)
  // "No issues right now" is a claim that both feeds actually reported zero
  // issues — it must never be reachable just because a dead feed handed
  // back an empty array. unavailable rows (below) own that case instead.
  const delayUnavailable = delayStatus === 'unavailable'
  const alertUnavailable = alertStatus === 'unavailable'
  const bothLoading = delayStatus === 'loading' && alertStatus === 'loading'
  const isEmpty =
    !delayUnavailable &&
    !alertUnavailable &&
    delayedVehicles.length === 0 &&
    alerts.length === 0 &&
    sortedEstimates.length === 0
  const viewingIndex = viewingAlertId != null ? alerts.findIndex((a) => a.id === viewingAlertId) : -1
  const viewingAlert = viewingIndex >= 0 ? alerts[viewingIndex] : null

  return (
    <div className="absolute bottom-24 right-4 z-40 w-80 max-h-[60vh] bg-white/85 dark:bg-gray-900/80 backdrop-blur-xl rounded-xl shadow-lg flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-amber-500 text-white shrink-0">
        <span className="text-sm font-semibold">Current issues</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-full hover:bg-white/20 shrink-0"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex flex-col overflow-y-auto">
        {bothLoading ? (
          <div className="px-4 py-4 text-sm text-gray-400 dark:text-gray-500 text-center">Loading…</div>
        ) : (
          <>
            {delayUnavailable && (
              <div className="flex items-start gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-950 border-b border-red-100 dark:border-red-900 text-red-600 dark:text-red-400">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-medium">Live delay data unavailable</p>
                  <p className="text-red-500/80 dark:text-red-400/70">Retrying…</p>
                </div>
              </div>
            )}
            {alertUnavailable && (
              <div className="flex items-start gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-950 border-b border-red-100 dark:border-red-900 text-red-600 dark:text-red-400">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-medium">Live alerts unavailable</p>
                  <p className="text-red-500/80 dark:text-red-400/70">Retrying…</p>
                </div>
              </div>
            )}
            {isEmpty ? (
              <div className="px-4 py-4 text-sm text-gray-400 dark:text-gray-500 text-center">No issues right now</div>
            ) : (
              <>
                {delayedVehicles.length > 0 && (
              <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-700">
                {delayedVehicles.map((v) => (
                  <button
                    key={v.vehicleId}
                    type="button"
                    onClick={() => onSelectVehicle(v)}
                    className="flex items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-amber-50 dark:hover:bg-amber-950"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="px-2 py-0.5 rounded text-xs font-bold text-white shrink-0"
                        style={{ backgroundColor: MODE_COLORS[v.mode] }}
                        title={MODE_LABELS[v.mode]}
                      >
                        {v.line}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 truncate">
                        <Navigation size={11} className="text-gray-400 shrink-0" />
                        {v.destination}
                      </span>
                    </div>
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium shrink-0">
                      {Math.round(v.delaySeconds / 60)}min
                    </span>
                  </button>
                ))}
              </div>
            )}
            {sortedEstimates.length > 0 && (
              <div className="flex flex-col border-t border-gray-100 dark:border-gray-700">
                <div className="px-4 pt-2 pb-1 text-xs font-semibold text-gray-400 dark:text-gray-500">
                  Slow roads — estimated
                </div>
                <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-700">
                  {sortedEstimates.map((e) => (
                    <div
                      key={e.routeGtfsId}
                      className="flex items-center justify-between gap-2 px-4 py-2.5"
                      title={`${e.detectorCount} traffic detector${e.detectorCount === 1 ? '' : 's'} along this route`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-2 py-0.5 rounded text-xs font-bold text-amber-700 dark:text-amber-300 border border-amber-400 dark:border-amber-600 shrink-0">
                          {e.shortName}
                        </span>
                        <span className="text-xs text-gray-600 dark:text-gray-300 truncate">{e.longName}</span>
                      </div>
                      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium shrink-0">
                        ~{Math.round(e.minSeconds / 60)}
                        {Math.round(e.maxSeconds / 60) > Math.round(e.minSeconds / 60)
                          ? `-${Math.round(e.maxSeconds / 60)}`
                          : ''}
                        min slower
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {alerts.length > 0 && !viewingAlert && (
              <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-700 border-t border-gray-100 dark:border-gray-700">
                {alerts.map((alert) => (
                  <button
                    key={alert.id}
                    type="button"
                    onClick={() => { setViewingAlertId(alert.id); onLocateAlert?.(alert) }}
                    className="w-full flex items-center gap-2 text-left px-4 py-2.5 hover:bg-amber-50 dark:hover:bg-amber-950"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        alert.severity === 'severe' ? 'bg-red-500' : 'bg-amber-500'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-200 block truncate">
                        {alert.headerText}
                      </span>
                      {alert.affectedRoutes.length > 0 && (
                        <span className="text-xs text-gray-400 block truncate">
                          Lines: {alert.affectedRoutes.join(', ')}
                        </span>
                      )}
                    </div>
                    <ChevronRight size={14} className="text-gray-300 shrink-0" />
                  </button>
                ))}
              </div>
            )}
            {viewingAlert && (
              <div className="flex flex-col border-t border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                  <button
                    type="button"
                    onClick={() => setViewingAlertId(null)}
                    className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  >
                    <ArrowLeft size={13} /> All issues
                  </button>
                  {alerts.length > 1 && (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>{viewingIndex + 1}/{alerts.length}</span>
                      <button
                        type="button"
                        aria-label="Previous disruption"
                        onClick={() => {
                          const prev = alerts[(viewingIndex - 1 + alerts.length) % alerts.length]
                          setViewingAlertId(prev.id)
                          onLocateAlert?.(prev)
                        }}
                        className="p-0.5 hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label="Next disruption"
                        onClick={() => {
                          const next = alerts[(viewingIndex + 1) % alerts.length]
                          setViewingAlertId(next.id)
                          onLocateAlert?.(next)
                        }}
                        className="p-0.5 hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        viewingAlert.severity === 'severe' ? 'bg-red-500' : 'bg-amber-500'
                      }`}
                    />
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                      {viewingAlert.headerText}
                    </span>
                  </div>
                  {viewingAlert.descriptionText && (
                    <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                      {viewingAlert.descriptionText}
                    </p>
                  )}
                  {viewingAlert.affectedRoutes.length > 0 && (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Lines: {viewingAlert.affectedRoutes.join(', ')}
                    </p>
                  )}
                  {viewingAlert.activePeriodEnd && (
                    <p className="mt-1 text-xs text-gray-400">
                      Until {new Date(viewingAlert.activePeriodEnd).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
