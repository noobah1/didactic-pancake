'use client'

import { useState } from 'react'
import { Star } from 'lucide-react'
import { LocationInput } from './LocationInput'
import { CitySelector } from './CitySelector'
import { FavoriteChip } from './FavoriteChip'
import { TransportMode } from '@/lib/types'
import { CityDef } from '@/lib/constants'
import { useFavorites } from '@/hooks/use-favorites'

interface SearchPanelProps {
  onSearch?: (fromPlace: string, toPlace: string, modes: TransportMode[], dateTime?: string, arriveBy?: boolean) => void
  onClear?: () => void
  modes?: TransportMode[]
  activeCities?: CityDef[]
  onCityToggle?: (city: CityDef) => void
  onCountyToggle?: (countyCities: CityDef[]) => void
  onSetAllCities?: (cities: CityDef[]) => void
  onViewStopBoard?: (name: string, lat: number, lng: number, stopId: string) => void
  // Called when the rider picks a line result from the same search box
  // (see LocationInput's stopsOnly mode, which now also returns lines —
  // /api/geocode). Resolves to whether a currently-active trip on that line
  // was found and selected (its last resort is a nationwide network fetch,
  // hence async), so this panel can show an inline "not running right now"
  // message on a miss without page.tsx needing to own that UI state.
  onSelectLine?: (mode: string, line: string) => boolean | Promise<boolean>
  // Passed down rather than calling usePushNotifications() again in here —
  // that hook's enabled/busy state is a separate useState per call site
  // with no cross-instance sync, so a second instance would drift from the
  // NotificationToggle's after any toggle.
  pushSupported: boolean
  pushEnabled: boolean
  onEnablePush: () => Promise<boolean>
}

export function SearchPanel({ onSearch, onClear, modes = [], activeCities, onCityToggle, onCountyToggle, onSetAllCities, onViewStopBoard, onSelectLine, pushSupported, pushEnabled, onEnablePush }: SearchPanelProps) {
  const [panelMode, setPanelMode] = useState<'plan' | 'board'>('plan')
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')
  const [fromCoords, setFromCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [toCoords, setToCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [timeMode, setTimeMode] = useState<'now' | 'depart' | 'arrive'>('now')
  const [dateTime, setDateTime] = useState('')
  const [pickerVisible, setPickerVisible] = useState(false)
  const [boardText, setBoardText] = useState('')
  // Set only when a picked line has no currently-active trip to show (see
  // onSelectLine) — cleared on the next successful pick or a fresh search.
  const [lineNotRunning, setLineNotRunning] = useState<string | null>(null)
  const { favorites, addFavorite, removeFavorite, findFavorite, setReminder } = useFavorites()

  const handleSearch = (from = fromCoords, to = toCoords) => {
    if (!from || !to) return
    const fromPlace = `${from.lat},${from.lng}`
    const toPlace = `${to.lat},${to.lng}`
    onSearch?.(fromPlace, toPlace, modes, dateTime || undefined, timeMode === 'arrive' ? true : undefined)
  }

  const handleClear = () => {
    setFromText('')
    setToText('')
    setFromCoords(null)
    setToCoords(null)
    onClear?.()
  }

  const handleFavoriteClick = (favorite: (typeof favorites)[number]) => {
    setFromText(favorite.fromName)
    setToText(favorite.toName)
    const from = { lat: favorite.fromLat, lng: favorite.fromLng }
    const to = { lat: favorite.toLat, lng: favorite.toLng }
    setFromCoords(from)
    setToCoords(to)
    handleSearch(from, to)
  }

  const activeFavorite = fromCoords && toCoords ? findFavorite(fromCoords.lat, fromCoords.lng, toCoords.lat, toCoords.lng) : null

  const handleSwap = () => {
    const newFromText = toText
    const newToText = fromText
    const newFromCoords = toCoords
    const newToCoords = fromCoords
    setFromText(newFromText)
    setToText(newToText)
    setFromCoords(newFromCoords)
    setToCoords(newToCoords)
    // Same "act immediately" pattern as picking a favorite chip -- if the
    // swapped fields already form a valid trip, there's no reason to make
    // someone press search again just to see the reversed direction.
    if (newFromCoords && newToCoords) handleSearch(newFromCoords, newToCoords)
  }

  const hasInput = fromText || toText

  return (
    <div className="flex flex-col gap-2">
      {onViewStopBoard && (
        <div className="flex gap-1 self-start bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-full p-0.5 shadow-md border border-gray-300 dark:border-gray-600">
          <button
            type="button"
            onClick={() => setPanelMode('plan')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${panelMode === 'plan' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'}`}
          >
            Plan trip
          </button>
          <button
            type="button"
            onClick={() => setPanelMode('board')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${panelMode === 'board' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'}`}
          >
            Departures
          </button>
        </div>
      )}
      {panelMode === 'board' && onViewStopBoard ? (
        <div className="flex flex-col gap-1">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-300 dark:border-gray-600">
            <LocationInput
              label="Stop or line"
              placeholder="Search for a stop or line..."
              value={boardText}
              onChange={(text) => {
                setBoardText(text)
                setLineNotRunning(null)
              }}
              stopsOnly
              cityIds={activeCities?.map((c) => c.id)}
              onSelect={async (name, lat, lng, stopId, line, mode) => {
                if (stopId) {
                  onViewStopBoard(name, lat, lng, stopId)
                  setBoardText('')
                  setLineNotRunning(null)
                  return
                }
                if (line && mode) {
                  const found = (await onSelectLine?.(mode, line)) ?? false
                  if (found) {
                    setBoardText('')
                    setLineNotRunning(null)
                  } else {
                    setLineNotRunning(line)
                  }
                }
              }}
            />
          </div>
          {lineNotRunning && (
            <p className="px-3 text-xs text-gray-500 dark:text-gray-400">
              No vehicles currently running on line {lineNotRunning}.
            </p>
          )}
        </div>
      ) : (
      <>
      <div className="flex gap-4">
        {/* Stacked search boxes */}
        <div className="relative flex-1 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleSwap}
            title="Swap from and to"
            aria-label="Swap from and to"
            className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/2 z-10 w-7 h-7 rounded-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 shadow-md flex items-center justify-center text-gray-500 dark:text-gray-300 hover:text-blue-700 dark:hover:text-blue-400 hover:border-blue-300 dark:hover:border-blue-600"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0-4-4m4 4-4 4M16 17H4m0 0 4 4m-4-4 4-4" />
            </svg>
          </button>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-300 dark:border-gray-600">
            <LocationInput
              label="From"
              placeholder="Current location or search..."
              value={fromText}
              onChange={setFromText}
              allowMyLocation
              onSelect={(name, lat, lng) => {
                setFromText(name)
                const coords = { lat, lng }
                setFromCoords(coords)
                if (toCoords) handleSearch(coords, toCoords)
              }}
            />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-300 dark:border-gray-600">
            <LocationInput
              label="To"
              placeholder="Where to?"
              value={toText}
              onChange={setToText}
              onSelect={(name, lat, lng) => {
                setToText(name)
                const coords = { lat, lng }
                setToCoords(coords)
                if (fromCoords) handleSearch(fromCoords, coords)
              }}
              trailing={
                fromCoords && toCoords ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeFavorite) removeFavorite(activeFavorite.id)
                      else addFavorite(fromText, fromCoords.lat, fromCoords.lng, toText, toCoords.lat, toCoords.lng)
                    }}
                    title={activeFavorite ? 'Remove favorite' : 'Save as favorite'}
                    aria-label={activeFavorite ? 'Remove favorite' : 'Save as favorite'}
                    className="shrink-0 mr-2 p-1.5 text-gray-400 hover:text-amber-500 dark:hover:text-amber-400"
                  >
                    <Star
                      size={18}
                      fill={activeFavorite ? '#F59E0B' : 'none'}
                      stroke={activeFavorite ? '#F59E0B' : 'currentColor'}
                      strokeWidth={2}
                    />
                  </button>
                ) : undefined
              }
            />
          </div>
        </div>
        {/* Clear button */}
        {hasInput && (
          <div className="flex flex-col items-center justify-start">
            <button
              onClick={handleClear}
              className="w-12 h-12 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded-full flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 shadow-md"
              aria-label="Clear search"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {!hasInput && favorites.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {favorites.map((favorite) => (
            <FavoriteChip
              key={favorite.id}
              favorite={favorite}
              onSelect={() => handleFavoriteClick(favorite)}
              onRemove={() => removeFavorite(favorite.id)}
              onSetReminder={(reminder) => setReminder(favorite.id, reminder)}
              pushSupported={pushSupported}
              pushEnabled={pushEnabled}
              onEnablePush={onEnablePush}
            />
          ))}
        </div>
      )}
      {/* Departure time selector + city selector */}
      <div className="flex items-center gap-2">
        {pickerVisible ? (
          <div className="flex items-center gap-1">
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="px-2 py-3 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-full text-base sm:text-xs shadow-md"
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
            className={`px-4 py-3 rounded-full text-sm shadow-md border ${timeMode !== 'now' && dateTime ? 'bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 font-medium' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
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
      </>
      )}
    </div>
  )
}
