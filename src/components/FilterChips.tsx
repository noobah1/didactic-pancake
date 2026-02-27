'use client'

import { useState } from 'react'
import { Bus, TramFront, TrainFront, Ship } from 'lucide-react'
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
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
        </svg>
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
