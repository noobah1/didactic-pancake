'use client'

import { useState } from 'react'
import { Bus, TramFront, TrainFront, Ship, SlidersHorizontal } from 'lucide-react'
import { TransportMode } from '@/lib/types'
import { MODE_LABELS, MODE_COLORS, ALL_MODES } from '@/lib/constants'

const MODE_ICONS: Record<TransportMode, React.ComponentType<{ size?: number }>> = {
  bus: Bus,
  tram: TramFront,
  train: TrainFront,
  ferry: Ship,
}

interface FilterChipsProps {
  activeModes: TransportMode[]
  onToggle: (mode: TransportMode) => void
}

export function FilterChips({ activeModes, onToggle }: FilterChipsProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label="Filters"
        className="w-12 h-12 bg-white rounded-full shadow-md flex items-center justify-center text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <SlidersHorizontal size={22} />
      </button>
      <div
        className={`flex items-center gap-1 overflow-hidden transition-all duration-200 ${
          expanded ? 'max-w-full opacity-100' : 'max-w-0 opacity-0'
        }`}
      >
        {ALL_MODES.map((mode) => {
          const active = activeModes.includes(mode)
          const Icon = MODE_ICONS[mode]
          return (
            <button
              key={mode}
              onClick={() => onToggle(mode)}
              className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap transition-colors border shadow-sm flex items-center gap-1.5 ${
                active ? 'text-white border-transparent' : 'text-gray-500 bg-white border-gray-300'
              }`}
              style={active ? { backgroundColor: MODE_COLORS[mode] } : undefined}
            >
              <Icon size={14} />
              {MODE_LABELS[mode]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
