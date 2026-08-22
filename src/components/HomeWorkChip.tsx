'use client'

import { Home, Briefcase, X } from 'lucide-react'
import { SavedPlace } from '@/lib/types'

interface HomeWorkChipProps {
  slot: 'home' | 'work'
  place?: SavedPlace
  // Whether there's currently a "To" place to save into this slot — only
  // relevant while `place` is unset (the "+ Home"/"+ Work" prompt).
  canSet: boolean
  onSelect: () => void
  onSet: () => void
  onClear: () => void
}

export function HomeWorkChip({ slot, place, canSet, onSelect, onSet, onClear }: HomeWorkChipProps) {
  const label = slot === 'home' ? 'Home' : 'Work'
  const Icon = slot === 'home' ? Home : Briefcase

  if (!place) {
    return (
      <button
        type="button"
        onClick={onSet}
        disabled={!canSet}
        title={canSet ? `Save "To" as ${label}` : `Enter a destination, then tap to save it as ${label}`}
        className="flex items-center gap-1 border border-dashed border-gray-300 dark:border-gray-600 rounded-2xl px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 disabled:opacity-50 enabled:hover:border-blue-300 enabled:hover:text-blue-600 dark:enabled:hover:border-blue-600 dark:enabled:hover:text-blue-400 enabled:cursor-pointer"
      >
        <Icon size={12} />
        <span>{label}</span>
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-2xl shadow-md pl-3 pr-1 py-1.5">
      <button
        type="button"
        onClick={onSelect}
        title={place.name}
        className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-200 hover:text-blue-700 dark:hover:text-blue-400"
      >
        <Icon size={12} className="text-blue-600 dark:text-blue-400" />
        <span className="max-w-[8rem] truncate">{label}</span>
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label} shortcut`}
        className="p-0.5 rounded-full text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
      >
        <X size={12} />
      </button>
    </div>
  )
}
