'use client'

import { useState } from 'react'
import { LocationInput } from './LocationInput'
import { TransportMode } from '@/lib/types'

interface SearchPanelProps {
  onSearch?: (fromPlace: string, toPlace: string, modes: TransportMode[], dateTime?: string) => void
  modes?: TransportMode[]
  hasResults?: boolean
}

export function SearchPanel({ onSearch, modes = [], hasResults }: SearchPanelProps) {
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

  return (
    <div className={`flex flex-col gap-3 p-4 bg-white shadow-lg ${hasResults ? 'rounded-t-xl' : 'rounded-xl'}`}>
      <h1 className="text-lg font-bold">Tallinn Transit</h1>
      <div className="flex flex-col gap-2">
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
      <div className="flex items-center gap-2">
        <select
          value={departureMode}
          onChange={(e) => setDepartureMode(e.target.value as 'now' | 'custom')}
          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="now">Depart now</option>
          <option value="custom">Depart at...</option>
        </select>
        {departureMode === 'custom' && (
          <input
            type="datetime-local"
            value={dateTime}
            onChange={(e) => setDateTime(e.target.value)}
            className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
          />
        )}
      </div>
      <button
        onClick={handleSearch}
        disabled={!fromCoords || !toCoords}
        className="w-full py-2 bg-blue-600 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
      >
        Search routes
      </button>
    </div>
  )
}
