'use client'

import { MapPin, X } from 'lucide-react'
import { useState, useMemo, useEffect, useRef } from 'react'
import { CityDef, CITIES, COUNTIES } from '@/lib/constants'

interface CitySelectorProps {
  activeCities: CityDef[]
  onToggle: (city: CityDef) => void
  onToggleCounty: (countyCities: CityDef[]) => void
}

export function CitySelector({ activeCities, onToggle, onToggleCounty }: CitySelectorProps) {
  const [expanded, setExpanded] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const activeIds = new Set(activeCities.map((c) => c.id))
  const label = activeCities.length === CITIES.length
    ? 'All'
    : activeCities.length === 1
      ? activeCities[0].name
      : `${activeCities.length} cities`

  const citiesByCounty = useMemo(() => {
    const map = new Map<string, CityDef[]>()
    for (const county of COUNTIES) {
      map.set(county, CITIES.filter((c) => c.county === county))
    }
    return map
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!expanded) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [expanded])

  return (
    <div ref={panelRef} className="relative">
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
      {expanded && (
        <div className="absolute top-12 left-0 z-50 bg-white rounded-2xl shadow-lg border border-gray-100 p-3 w-[calc(100vw-24px)] sm:w-[460px] max-h-[60vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Counties</span>
            <button
              onClick={() => setExpanded(false)}
              className="p-1 rounded-full hover:bg-gray-100 transition-colors"
            >
              <X size={14} className="text-gray-400" />
            </button>
          </div>
          {/* County grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {COUNTIES.map((county) => {
              const cities = citiesByCounty.get(county) || []
              const allActive = cities.every((c) => activeIds.has(c.id))
              const someActive = cities.some((c) => activeIds.has(c.id))
              return (
                <div key={county} className="flex flex-col gap-1">
                  <button
                    onClick={() => onToggleCounty(cities)}
                    className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded transition-colors text-left ${
                      allActive
                        ? 'text-blue-700 bg-blue-50'
                        : someActive
                          ? 'text-blue-500 bg-blue-50/50'
                          : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {county}
                  </button>
                  <div className="flex flex-wrap gap-1">
                    {cities.map((city) => {
                      const active = activeIds.has(city.id)
                      return (
                        <button
                          key={city.id}
                          onClick={() => onToggle(city)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border ${
                            active
                              ? 'text-white bg-blue-600 border-blue-600'
                              : 'text-gray-500 bg-white border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          {city.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
