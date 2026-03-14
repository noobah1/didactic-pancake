'use client'

import { useState } from 'react'
import { LocationInput } from './LocationInput'
import { CitySelector } from './CitySelector'
import { TransportMode } from '@/lib/types'
import { CityDef } from '@/lib/constants'

interface SearchPanelProps {
  onSearch?: (fromPlace: string, toPlace: string, modes: TransportMode[], dateTime?: string, arriveBy?: boolean) => void
  onClear?: () => void
  modes?: TransportMode[]
  activeCities?: CityDef[]
  onCityToggle?: (city: CityDef) => void
  onCountyToggle?: (countyCities: CityDef[]) => void
  onSetAllCities?: (cities: CityDef[]) => void
}

export function SearchPanel({ onSearch, onClear, modes = [], activeCities, onCityToggle, onCountyToggle, onSetAllCities }: SearchPanelProps) {
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')
  const [fromCoords, setFromCoords] = useState<{ name: string; lat: number; lng: number } | null>(null)
  const [toCoords, setToCoords] = useState<{ name: string; lat: number; lng: number } | null>(null)
  const [timeMode, setTimeMode] = useState<'now' | 'depart' | 'arrive'>('now')
  const [dateTime, setDateTime] = useState('')
  const [pickerVisible, setPickerVisible] = useState(false)

  const handleSearch = () => {
    if (!fromCoords || !toCoords) {
      console.warn('⚠️ Missing coords:', { fromCoords, toCoords })
      return
    }
    const fromPlace = `${fromCoords.name},${fromCoords.lat},${fromCoords.lng}`
    const toPlace = `${toCoords.name},${toCoords.lat},${toCoords.lng}`
    console.log('🚀 Searching routes with:', { fromPlace, toPlace, fromCoords, toCoords })
    onSearch?.(fromPlace, toPlace, modes, dateTime || undefined, timeMode === 'arrive' ? true : undefined)
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
                setFromCoords({ name, lat, lng })
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
                setToCoords({ name, lat, lng })
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
      {/* Departure time selector + city selector */}
      <div className="flex items-center gap-2">
        {pickerVisible ? (
          <div className="flex items-center gap-1">
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="px-2 py-3 bg-white border border-gray-300 rounded-full text-xs shadow-md"
            />
            {dateTime && (
              <button
                type="button"
                onClick={() => setPickerVisible(false)}
                className="px-3 py-3 bg-blue-600 text-white rounded-full text-xs font-medium shadow-md"
              >
                Done
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (timeMode === 'now') {
                setTimeMode('depart')
                setPickerVisible(true)
              } else if (timeMode === 'depart') {
                setTimeMode('arrive')
                if (!dateTime) setPickerVisible(true)
              } else {
                setTimeMode('now')
                setDateTime('')
              }
            }}
            className={`px-4 py-3 rounded-full text-sm shadow-md border transition-colors ${timeMode !== 'now' && dateTime ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            {timeMode === 'now' && 'Depart now'}
            {timeMode === 'depart' && (dateTime
              ? `Depart ${new Date(dateTime).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}`
              : 'Depart at...')}
            {timeMode === 'arrive' && (dateTime
              ? `Arrive ${new Date(dateTime).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}`
              : 'Arrive at...')}
          </button>
        )}
        {activeCities && onCityToggle && onCountyToggle && onSetAllCities && (
          <CitySelector activeCities={activeCities} onToggle={onCityToggle} onToggleCounty={onCountyToggle} onSetAll={onSetAllCities} />
        )}
      </div>
    </div>
  )
}
