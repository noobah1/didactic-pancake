'use client'

import { useState } from 'react'
import { Star, X, Clock, TriangleAlert } from 'lucide-react'
import { FavoriteRoute } from '@/lib/types'
import { DEFAULT_LEAD_MINUTES } from '@/lib/reminder'

interface FavoriteChipProps {
  favorite: FavoriteRoute
  onSelect: () => void
  onRemove: () => void
  onSetReminder: (reminder: { enabled: boolean; time: string; leadMinutes: number }) => void
  pushSupported: boolean
  pushEnabled: boolean
  onEnablePush: () => Promise<boolean>
}

const DEFAULT_TIME = '08:00'

export function FavoriteChip({ favorite, onSelect, onRemove, onSetReminder, pushSupported, pushEnabled, onEnablePush }: FavoriteChipProps) {
  const [editing, setEditing] = useState(false)
  const hasReminder = !!favorite.reminderEnabled && !!favorite.reminderTime

  // Editing state lives locally, seeded from the favorite only when the
  // editor opens — driving the inputs off favorite.* directly instead had
  // every keystroke round-trip through onSetReminder -> localStorage write
  // -> a "favorites-changed" event -> this component re-rendering with a
  // new prop, and a fast keystroke could land before that round-trip
  // resolved, leaving the input concatenating onto a stale value (typing
  // "15" could end up persisting as "1215"). Local state updates
  // synchronously within the component, so the input always reflects
  // exactly what was typed regardless of how long the persist round-trip takes.
  const [time, setTime] = useState(favorite.reminderTime || DEFAULT_TIME)
  const [leadMinutes, setLeadMinutes] = useState(favorite.reminderLeadMinutes ?? DEFAULT_LEAD_MINUTES)

  const openEditor = () => {
    if (!editing) {
      setTime(favorite.reminderTime || DEFAULT_TIME)
      setLeadMinutes(favorite.reminderLeadMinutes ?? DEFAULT_LEAD_MINUTES)
    }
    setEditing((v) => !v)
  }

  return (
    <div className="flex flex-col bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-2xl shadow-md overflow-hidden">
      <div className="flex items-center gap-1 pl-3 pr-1 py-1.5">
        <button
          type="button"
          onClick={onSelect}
          className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-200 hover:text-blue-700 dark:hover:text-blue-400 transition-colors"
        >
          <Star size={12} fill="#F59E0B" stroke="#F59E0B" />
          <span className="max-w-[10rem] truncate">{favorite.fromName}</span>
          <span className="text-gray-400">&rarr;</span>
          <span className="max-w-[10rem] truncate">{favorite.toName}</span>
        </button>
        <button
          type="button"
          onClick={openEditor}
          title={hasReminder ? `Leave-now reminder at ${favorite.reminderTime}` : 'Set a leave-now reminder'}
          aria-label={hasReminder ? `Leave-now reminder at ${favorite.reminderTime}` : 'Set a leave-now reminder'}
          className={`p-0.5 rounded-full transition-colors ${
            hasReminder
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
          }`}
        >
          <Clock size={12} fill={hasReminder ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove favorite ${favorite.fromName} to ${favorite.toName}`}
          className="p-0.5 rounded-full text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <X size={12} />
        </button>
      </div>
      {editing && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 pb-2 pt-1 border-t border-gray-100 dark:border-gray-700">
          <label className="flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={hasReminder}
              onChange={(e) => {
                // Persist the reminder either way — even if the permission
                // prompt below gets denied, the setting itself shouldn't be
                // lost, and the warning underneath tells the rider it can't
                // fire yet.
                onSetReminder({ enabled: e.target.checked, time, leadMinutes })
                if (e.target.checked && pushSupported && !pushEnabled) onEnablePush()
              }}
            />
            Remind me
          </label>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">leave by</span>
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value)
              onSetReminder({ enabled: true, time: e.target.value, leadMinutes })
            }}
            className="px-1.5 py-0.5 text-[11px] bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded"
          />
          <input
            type="number"
            min={1}
            max={60}
            value={leadMinutes}
            onChange={(e) => {
              if (e.target.value === '') {
                setLeadMinutes(0) // mid-edit (cleared to retype) — not persisted until a real number lands
                return
              }
              const parsed = parseInt(e.target.value, 10)
              if (Number.isNaN(parsed)) return
              const clamped = Math.min(60, Math.max(1, parsed))
              setLeadMinutes(clamped)
              onSetReminder({ enabled: true, time, leadMinutes: clamped })
            }}
            className="w-11 px-1.5 py-0.5 text-[11px] bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded"
          />
          <span className="text-[11px] text-gray-500 dark:text-gray-400">min heads-up, weekdays</span>
          {hasReminder && !pushEnabled && (
            <span className="flex items-center gap-1 w-full text-[11px] text-amber-600 dark:text-amber-400">
              <TriangleAlert size={12} />
              {pushSupported
                ? 'Turn on notifications (bell, bottom right) or this reminder won’t fire.'
                : "This browser can't show notifications, so this reminder won't fire."}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
