'use client'

import { useState, useRef, useEffect } from 'react'
import { LocateFixed } from 'lucide-react'
import { useGeocode } from '@/hooks/use-geocode'
import { useCurrentLocation } from '@/hooks/use-current-location'

interface LocationInputProps {
  label: string
  placeholder: string
  value: string
  onSelect: (name: string, lat: number, lng: number) => void
  onChange: (value: string) => void
  /** Show a crosshair button that fills this field with the user's position */
  showLocate?: boolean
}

export function LocationInput({
  label,
  placeholder,
  value,
  onSelect,
  onChange,
  showLocate = false,
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

  const handleSelect = (result: { name: string; lat: number; lng: number }) => {
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

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex items-center">
        <input
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
          placeholder={`${label}: ${placeholder}`}
          className="flex-1 min-w-0 px-3 py-3 text-sm focus:outline-none"
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
      {showDropdown && results.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => handleSelect(r)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 truncate"
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
