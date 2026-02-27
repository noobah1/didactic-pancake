'use client'

import { useState } from 'react'
import { TransportMode } from '@/lib/types'
import { MODE_LABELS, MODE_COLORS, ALL_MODES } from '@/lib/constants'

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
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-full shadow-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        Filters
      </button>
      <div
        className={`flex items-center gap-1 overflow-hidden transition-all duration-200 ${
          expanded ? 'max-w-md opacity-100' : 'max-w-0 opacity-0'
        }`}
      >
        {ALL_MODES.map((mode) => {
          const active = activeModes.includes(mode)
          return (
            <button
              key={mode}
              onClick={() => onToggle(mode)}
              className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap transition-colors border shadow-sm ${
                active ? 'text-white border-transparent' : 'text-gray-500 bg-white border-gray-300'
              }`}
              style={active ? { backgroundColor: MODE_COLORS[mode] } : undefined}
            >
              {MODE_LABELS[mode]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
