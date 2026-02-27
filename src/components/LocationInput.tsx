'use client'

import { useState, useRef, useEffect } from 'react'
import { useGeocode } from '@/hooks/use-geocode'

interface LocationInputProps {
  label: string
  placeholder: string
  value: string
  onSelect: (name: string, lat: number, lng: number) => void
  onChange: (value: string) => void
}

export function LocationInput({
  label,
  placeholder,
  value,
  onSelect,
  onChange,
}: LocationInputProps) {
  const [showDropdown, setShowDropdown] = useState(false)
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

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => results.length > 0 && setShowDropdown(true)}
        placeholder={`${label}: ${placeholder}`}
        className="w-full px-3 py-3 text-sm focus:outline-none"
      />
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
