'use client'

import { useState } from 'react'
import { LocationInput } from './LocationInput'
import { TransportMode } from '@/lib/types'

interface SearchPanelProps {
  onSearch?: (fromPlace: string, toPlace: string, modes: TransportMode[]) => void
  modes?: TransportMode[]
}

export function SearchPanel({ onSearch, modes = [] }: SearchPanelProps = {}) {
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')
  const [fromCoords, setFromCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [toCoords, setToCoords] = useState<{ lat: number; lng: number } | null>(null)

  const handleSearch = () => {
    if (!fromCoords || !toCoords) return
    const fromPlace = `${fromCoords.lat},${fromCoords.lng}`
    const toPlace = `${toCoords.lat},${toCoords.lng}`
    onSearch?.(fromPlace, toPlace, modes)
  }

  return (
    <div className="flex flex-col gap-3 p-4 bg-white border-b border-gray-200">
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
