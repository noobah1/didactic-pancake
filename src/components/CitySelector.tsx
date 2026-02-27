'use client'

import { MapPin } from 'lucide-react'
import { useState } from 'react'
import { CityDef, CITIES } from '@/lib/constants'

interface CitySelectorProps {
  activeCities: CityDef[]
  onToggle: (city: CityDef) => void
}

export function CitySelector({ activeCities, onToggle }: CitySelectorProps) {
  const [expanded, setExpanded] = useState(false)
  const activeIds = new Set(activeCities.map((c) => c.id))
  const label = activeCities.length === CITIES.length
    ? 'All'
    : activeCities.length === 1
      ? activeCities[0].name
      : `${activeCities.length} cities`

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label="Cities"
        className="flex items-center gap-1.5 h-10 px-3 bg-white rounded-full shadow-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <MapPin size={14} />
        {label}
        <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      <div
        className={`flex items-center gap-1 overflow-hidden transition-all duration-200 ${
          expanded ? 'max-w-full opacity-100' : 'max-w-0 opacity-0'
        }`}
      >
        {CITIES.map((city) => {
          const active = activeIds.has(city.id)
          return (
            <button
              key={city.id}
              onClick={() => onToggle(city)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors border shadow-sm ${
                active
                  ? 'text-white bg-blue-600 border-blue-600'
                  : 'text-gray-500 bg-white border-gray-300'
              }`}
            >
              {city.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
