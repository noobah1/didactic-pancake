'use client'

import { TransportMode } from '@/lib/types'
import { MODE_LABELS, MODE_COLORS, ALL_MODES } from '@/lib/constants'

interface FilterChipsProps {
  activeModes: TransportMode[]
  onToggle: (mode: TransportMode) => void
}

export function FilterChips({ activeModes, onToggle }: FilterChipsProps) {
  return (
    <div className="flex gap-2 px-4 py-2 bg-white border-b border-gray-200 overflow-x-auto">
      {ALL_MODES.map((mode) => {
        const active = activeModes.includes(mode)
        return (
          <button
            key={mode}
            onClick={() => onToggle(mode)}
            className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap transition-colors border ${
              active ? 'text-white border-transparent' : 'text-gray-500 bg-white border-gray-300'
            }`}
            style={active ? { backgroundColor: MODE_COLORS[mode] } : undefined}
          >
            {MODE_LABELS[mode]}
          </button>
        )
      })}
    </div>
  )
}
