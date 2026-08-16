'use client'

import { useState } from 'react'
import { X, Navigation, ChevronDown, ChevronUp } from 'lucide-react'
import { MODE_COLORS, MODE_LABELS } from '@/lib/constants'
import { OVERVIEW_THRESHOLD_SEC } from '@/lib/delay'
import { DelayedVehicle } from '@/app/api/delays/route'
import { ServiceAlert } from '@/lib/types'

interface IssuesPanelProps {
  vehicles: DelayedVehicle[]
  alerts: ServiceAlert[]
  onSelectVehicle: (vehicle: DelayedVehicle) => void
  onClose: () => void
}

export function IssuesPanel({ vehicles, alerts, onSelectVehicle, onClose }: IssuesPanelProps) {
  // Accordion, not a checklist — only one disruption's full detail is open
  // at a time, so browsing dozens of them (Tark Tee) one by one stays a
  // compact list rather than a wall of expanded description text.
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null)
  const delayedVehicles = vehicles
    .filter((v) => v.delaySeconds >= OVERVIEW_THRESHOLD_SEC)
    .sort((a, b) => b.delaySeconds - a.delaySeconds)
  const isEmpty = delayedVehicles.length === 0 && alerts.length === 0

  return (
    <div className="absolute bottom-24 right-4 z-40 w-80 max-h-[60vh] bg-white dark:bg-gray-800 rounded-xl shadow-lg flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-amber-500 text-white shrink-0">
        <span className="text-sm font-semibold">Current issues</span>
        <button
          onClick={onClose}
          className="p-1 rounded-full hover:bg-white/20 transition-colors shrink-0"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex flex-col overflow-y-auto">
        {isEmpty ? (
          <div className="px-4 py-4 text-sm text-gray-400 text-center">No issues right now</div>
        ) : (
          <>
            {delayedVehicles.length > 0 && (
              <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-700">
                {delayedVehicles.map((v) => (
                  <button
                    key={v.vehicleId}
                    type="button"
                    onClick={() => onSelectVehicle(v)}
                    className="flex items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-amber-50 dark:hover:bg-amber-950 transition-colors"
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
            {alerts.length > 0 && (
              <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-700 border-t border-gray-100 dark:border-gray-700">
                {alerts.map((alert) => {
                  const expanded = expandedAlertId === alert.id
                  return (
                    <button
                      key={alert.id}
                      type="button"
                      onClick={() => setExpandedAlertId(expanded ? null : alert.id)}
                      className="w-full text-left px-4 py-2.5 hover:bg-amber-50 dark:hover:bg-amber-950 transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            alert.severity === 'severe' ? 'bg-red-500' : 'bg-amber-500'
                          }`}
                        />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200 flex-1 min-w-0 truncate">
                          {alert.headerText}
                        </span>
                        {expanded ? (
                          <ChevronUp size={12} className="text-gray-400 shrink-0" />
                        ) : (
                          <ChevronDown size={12} className="text-gray-400 shrink-0" />
                        )}
                      </div>
                      {alert.affectedRoutes.length > 0 && (
                        <span className="text-xs text-gray-400 ml-3 block truncate">
                          Lines: {alert.affectedRoutes.join(', ')}
                        </span>
                      )}
                      {expanded && (
                        <div className="mt-1.5 ml-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
                          {alert.descriptionText && <p>{alert.descriptionText}</p>}
                          {alert.activePeriodEnd && (
                            <p className="text-gray-400">
                              Until {new Date(alert.activePeriodEnd).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
