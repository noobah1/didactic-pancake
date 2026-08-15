'use client'

import { useState, useRef, useEffect } from 'react'
import { useGeocode } from '@/hooks/use-geocode'

interface LocationInputProps {
  label: string
  placeholder: string
  value: string
  onSelect: (name: string, lat: number, lng: number) => void
  onChange: (value: string) => void
  allowMyLocation?: boolean
}

export function LocationInput({
  label,
  placeholder,
  value,
  onSelect,
  onChange,
  allowMyLocation,
}: LocationInputProps) {
  const [showDropdown, setShowDropdown] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)
  const { results, search, clear } = useGeocode()
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

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setLocateError('Geolocation not supported')
      return
    }
    setLocating(true)
    setLocateError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        onSelect('My location', position.coords.latitude, position.coords.longitude)
        setShowDropdown(false)
        clear()
      },
      (error) => {
        setLocating(false)
        setLocateError(error.code === error.PERMISSION_DENIED ? 'Location access denied' : 'Could not get location')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
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
          className="w-full px-3 py-3 text-base sm:text-sm focus:outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
        {allowMyLocation && (
          <button
            type="button"
            onClick={handleUseMyLocation}
            disabled={locating}
            title="Use my current location"
            aria-label="Use my current location"
            className="shrink-0 mr-2 p-1.5 text-gray-400 hover:text-blue-700 dark:hover:text-blue-400 disabled:opacity-50 transition-colors"
          >
            {locating ? (
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.364 6.364-2.121-2.121M8.757 8.757 6.636 6.636m10.728 0-2.121 2.121M8.757 15.243l-2.121 2.121" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v2m0 16v2m10-10h-2M4 12H2" />
                <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
              </svg>
            )}
          </button>
        )}
      </div>
      {locateError && (
        <p className="absolute z-50 w-full mt-1 px-3 py-1.5 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 text-xs rounded-lg border border-red-200 dark:border-red-800">
          {locateError}
        </p>
      )}
      {showDropdown && results.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => handleSelect(r)}
                className="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 truncate"
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
