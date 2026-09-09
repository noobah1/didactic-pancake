'use client'

import { useState, useRef, useEffect } from 'react'
import { LocateFixed, Star, Clock } from 'lucide-react'
import { useGeocode } from '@/hooks/use-geocode'
import { useCurrentLocation } from '@/hooks/use-current-location'

interface GeoResult {
  name: string
  lat: number
  lng: number
}

interface Suggestion extends GeoResult {
  group: 'saved' | 'recent'
  id?: string
}

interface LocationInputProps {
  label: string
  placeholder: string
  value: string
  onSelect: (name: string, lat: number, lng: number) => void
  onChange: (value: string) => void
  /** Show a crosshair button that fills this field with the user's position */
  showLocate?: boolean
  /** Saved places / recent searches shown when the field is empty or on focus */
  suggestions?: Suggestion[]
  /** Show a star button on geocoder results to save them for next time */
  onSaveResult?: (place: GeoResult) => void
}

export function LocationInput({
  label,
  placeholder,
  value,
  onSelect,
  onChange,
  showLocate = false,
  suggestions,
  onSaveResult,
}: LocationInputProps) {
  const [showDropdown, setShowDropdown] = useState(false)
  const { results, search, clear } = useGeocode()
  const { status, error: locError, locate } = useCurrentLocation()
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleChange = (text: string) => {
    onChange(text)
    search(text)
    setShowDropdown(true)
  }

  const handleSelect = (result: GeoResult) => {
    onSelect(result.name, result.lat, result.lng)
    setShowDropdown(false)
    clear()
  }

  const handleLocate = async () => {
    const pos = await locate()
    if (!pos) return
    let name = 'My location'
    try {
      const res = await fetch(`/api/geocode?lat=${pos.lat}&lng=${pos.lng}`)
      if (res.ok) {
        const data = await res.json()
        if (data.name) name = data.name
      }
    } catch {
      // keep the generic label — the coordinates are what actually matter
    }
    onSelect(name, pos.lat, pos.lng)
    setShowDropdown(false)
    clear()
  }

  const showSuggestions = value.trim().length < 2 && (suggestions?.length ?? 0) > 0
  const items: (GeoResult | Suggestion)[] = showSuggestions ? suggestions! : results

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex items-center">
        <input
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setShowDropdown(true)}
          placeholder={`${label}: ${placeholder}`}
          className="flex-1 min-w-0 px-3 py-3 text-base sm:text-sm focus:outline-none"
        />
        {showLocate && (
          <button
            type="button"
            onClick={handleLocate}
            disabled={status === 'locating'}
            aria-label="Use my current location"
            title={locError || 'Use my current location'}
            className={`shrink-0 mr-2 p-2 rounded-full transition-colors disabled:opacity-50 ${
              status === 'denied' || status === 'unavailable'
                ? 'text-gray-300'
                : 'text-blue-600 hover:bg-blue-50'
            }`}
          >
            <LocateFixed size={18} className={status === 'locating' ? 'animate-pulse' : ''} />
          </button>
        )}
      </div>
      {locError && (
        <p className="px-3 pb-2 text-xs text-amber-600">{locError}</p>
      )}
      {showDropdown && items.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {items.map((r, i) => {
            const group = 'group' in r ? r.group : undefined
            const prevItem = i > 0 ? items[i - 1] : undefined
            const prevGroup = prevItem && 'group' in prevItem ? prevItem.group : undefined
            return (
              <li key={i}>
                {group && group !== prevGroup && (
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {group === 'saved' ? 'Saved' : 'Recent'}
                  </div>
                )}
                <div className="flex items-center group/row">
                  <button
                    type="button"
                    onClick={() => handleSelect(r)}
                    className="flex-1 min-w-0 px-3 py-2 text-left text-sm hover:bg-gray-100 truncate flex items-center gap-2"
                  >
                    {group === 'saved' && <Star size={14} className="shrink-0 text-amber-500" />}
                    {group === 'recent' && <Clock size={14} className="shrink-0 text-gray-400" />}
                    <span className="truncate">{r.name}</span>
                  </button>
                  {!group && onSaveResult && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSaveResult(r)
                      }}
                      aria-label={`Save ${r.name}`}
                      title="Save this place"
                      className="shrink-0 p-2 mr-1 text-gray-300 hover:text-amber-500 transition-colors"
                    >
                      <Star size={14} />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
