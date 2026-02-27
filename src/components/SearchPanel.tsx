'use client'

import { useState } from 'react'
import { LocationInput } from './LocationInput'
import { TransportMode } from '@/lib/types'

interface SearchPanelProps {
  onSearch?: (fromPlace: string, toPlace: string, modes: TransportMode[], dateTime?: string) => void
  onClear?: () => void
  modes?: TransportMode[]
}

export function SearchPanel({ onSearch, onClear, modes = [] }: SearchPanelProps) {
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')
  const [fromCoords, setFromCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [toCoords, setToCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [departureMode, setDepartureMode] = useState<'now' | 'custom'>('now')
  const [dateTime, setDateTime] = useState('')

  const handleSearch = () => {
    if (!fromCoords || !toCoords) return
    const fromPlace = `${fromCoords.lat},${fromCoords.lng}`
    const toPlace = `${toCoords.lat},${toCoords.lng}`
    onSearch?.(fromPlace, toPlace, modes, departureMode === 'custom' && dateTime ? dateTime : undefined)
  }

  const handleClear = () => {
    setFromText('')
    setToText('')
    setFromCoords(null)
    setToCoords(null)
    onClear?.()
  }

  const hasInput = fromText || toText

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {/* Stacked search boxes */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="bg-white rounded-xl shadow-lg border border-gray-300">
            <LocationInput
              label="From"
              placeholder="Current location or search..."
              value={fromText}
              onChange={setFromText}
              onSelect={(name, lat, lng) => {
                setFromText(name)
                setFromCoords({ lat, lng })
              }}
            />
          </div>
          <div className="bg-white rounded-xl shadow-lg border border-gray-300">
            <LocationInput
              label="To"
              placeholder="Where to?"
              value={toText}
              onChange={setToText}
              onSelect={(name, lat, lng) => {
                setToText(name)
                setToCoords({ lat, lng })
              }}
            />
          </div>
        </div>
        {/* Buttons - stacked vertically to the right */}
        <div className={`flex flex-col items-center ${hasInput ? 'justify-start' : 'justify-center'} gap-1.5`}>
          {hasInput && (
            <button
              onClick={handleClear}
              className="w-12 h-12 bg-white border border-gray-300 text-gray-500 rounded-full flex items-center justify-center hover:bg-gray-50 hover:text-gray-700 transition-colors shadow-md"
              aria-label="Clear search"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <button
            onClick={handleSearch}
            disabled={!fromCoords || !toCoords}
            className="w-12 h-12 bg-white border-2 border-blue-800 text-blue-800 rounded-full flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors shadow-lg"
            aria-label="Search routes"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </button>
        </div>
      </div>
      {/* Departure time selector */}
      <div className="flex items-center gap-2">
        <select
          value={departureMode}
          onChange={(e) => setDepartureMode(e.target.value as 'now' | 'custom')}
          className="px-2 py-3 bg-white border border-gray-300 rounded-lg text-sm shadow-md"
        >
          <option value="now">Depart now</option>
          <option value="custom">Depart at...</option>
        </select>
        {departureMode === 'custom' && (
          <input
            type="datetime-local"
            value={dateTime}
            onChange={(e) => setDateTime(e.target.value)}
            className="flex-1 px-2 py-3 bg-white border border-gray-300 rounded-lg text-sm shadow-md"
          />
        )}
      </div>
    </div>
  )
}
