'use client'

import { useState } from 'react'
import { Star, Accessibility } from 'lucide-react'
import { LocationInput } from './LocationInput'
import { CitySelector } from './CitySelector'
import { FavoriteChip } from './FavoriteChip'
import { RecentChip } from './RecentChip'
import { HomeWorkChip } from './HomeWorkChip'
import { LanguageSelector } from './LanguageSelector'
import { RiderProfileSelector } from './RiderProfileSelector'
import { TransportMode } from '@/lib/types'
import { CityDef } from '@/lib/constants'
import { useFavorites } from '@/hooks/use-favorites'
import { useRecentSearches } from '@/hooks/use-recent-searches'
import { useHomeWork } from '@/hooks/use-home-work'
import { useTranslation } from '@/lib/i18n/context'
import { localeTag } from '@/lib/i18n/format'

interface SearchPanelProps {
  onSearch?: (fromPlace: string, toPlace: string, modes: TransportMode[], dateTime?: string, arriveBy?: boolean, wheelchair?: boolean) => void
  onClear?: () => void
  modes?: TransportMode[]
  activeCities?: CityDef[]
  onCityToggle?: (city: CityDef) => void
  onCountyToggle?: (countyCities: CityDef[]) => void
  onSetAllCities?: (cities: CityDef[]) => void
  // Lifted to page.tsx (like activeCities) rather than kept local, so a
  // "Get alternatives" re-search — which calls the plan hook directly,
  // bypassing this panel — can still honor the rider's own accessibility
  // choice instead of silently dropping it.
  wheelchair?: boolean
  onWheelchairToggle?: () => void
  onViewStopBoard?: (name: string, lat: number, lng: number, stopId: string) => void
  // Called when the rider picks a line result from the same search box
  // (see LocationInput's stopsOnly mode, which now also returns lines —
  // /api/geocode). Resolves to whether a currently-active trip on that line
  // was found and selected (its last resort is a nationwide network fetch,
  // hence async), so this panel can show an inline "not running right now"
  // message on a miss without page.tsx needing to own that UI state.
  onSelectLine?: (mode: string, line: string, lat: number, lng: number) => boolean | Promise<boolean>
}

export function SearchPanel({ onSearch, onClear, modes = [], activeCities, onCityToggle, onCountyToggle, onSetAllCities, wheelchair = false, onWheelchairToggle, onViewStopBoard, onSelectLine }: SearchPanelProps) {
  const { t, locale } = useTranslation()
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
  const { favorites, addFavorite, removeFavorite, findFavorite } = useFavorites()
  const { recents, logSearch, removeRecent } = useRecentSearches()
  const { places: homeWork, setPlace: setHomeWork, clearPlace: clearHomeWork } = useHomeWork()

  const handleSearch = (
    from = fromCoords,
    to = toCoords,
    fromName = fromText,
    toName = toText,
    dt = dateTime,
    arriveBy = timeMode === 'arrive',
    wc = wheelchair,
  ) => {
    if (!from || !to) return
    const fromPlace = `${from.lat},${from.lng}`
    const toPlace = `${to.lat},${to.lng}`
    onSearch?.(fromPlace, toPlace, modes, dt || undefined, arriveBy ? true : undefined, wc || undefined)
    // Favorites already get their own always-visible chip — logging one as
    // a recent too would just show the same trip twice in the quick-pick row.
    if (!findFavorite(from.lat, from.lng, to.lat, to.lng)) {
      logSearch(fromName, from.lat, from.lng, toName, to.lat, to.lng)
    }
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
    handleSearch(from, to, favorite.fromName, favorite.toName)
  }

  const handleRecentClick = (recent: (typeof recents)[number]) => {
    setFromText(recent.fromName)
    setToText(recent.toName)
    const from = { lat: recent.fromLat, lng: recent.fromLng }
    const to = { lat: recent.toLat, lng: recent.toLng }
    setFromCoords(from)
    setToCoords(to)
    handleSearch(from, to, recent.fromName, recent.toName)
  }

  // Tapping a set Home/Work chip fills "To" with it. If "From" is already
  // picked, search right away; otherwise fall back to the rider's current
  // position, same as LocationInput's "use my location" button, since a
  // home/work shortcut with no "From" set would otherwise just sit there
  // needing a manual pick to do anything.
  const handleHomeWorkClick = (slot: 'home' | 'work') => {
    const place = homeWork[slot]
    if (!place) return
    setToText(place.name)
    setToCoords({ lat: place.lat, lng: place.lng })
    if (fromCoords) {
      handleSearch(fromCoords, { lat: place.lat, lng: place.lng }, fromText, place.name)
      return
    }
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = { lat: position.coords.latitude, lng: position.coords.longitude }
        setFromText(t('location.myLocation'))
        setFromCoords(coords)
        handleSearch(coords, { lat: place.lat, lng: place.lng }, t('location.myLocation'), place.name)
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const handleSetHomeWork = (slot: 'home' | 'work') => {
    if (!toCoords) return
    setHomeWork(slot, { name: toText, lat: toCoords.lat, lng: toCoords.lng })
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
    if (newFromCoords && newToCoords) handleSearch(newFromCoords, newToCoords, newFromText, newToText)
  }

  const hasInput = fromText || toText

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {onViewStopBoard ? (
          <div className="flex gap-1 self-start bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-full p-0.5 shadow-md border border-gray-300 dark:border-gray-600">
            <button
              type="button"
              onClick={() => setPanelMode('plan')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${panelMode === 'plan' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'}`}
            >
              {t('search.planTrip')}
            </button>
            <button
              type="button"
              onClick={() => setPanelMode('board')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${panelMode === 'board' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'}`}
            >
              {t('search.departures')}
            </button>
          </div>
        ) : <div />}
        <LanguageSelector />
      </div>
      {panelMode === 'board' && onViewStopBoard ? (
        <div className="flex flex-col gap-1">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-300 dark:border-gray-600">
            <LocationInput
              label={t('search.stopOrLine')}
              placeholder={t('search.searchStopOrLine')}
              value={boardText}
              onChange={(text) => {
                setBoardText(text)
                setLineNotRunning(null)
              }}
              stopsOnly
              cityIds={activeCities?.map((c) => c.id)}
              onSelect={async ({ name, lat, lng, stopId, line, mode }) => {
                if (stopId) {
                  onViewStopBoard(name, lat, lng, stopId)
                  setBoardText('')
                  setLineNotRunning(null)
                  return
                }
                if (line && mode) {
                  const found = (await onSelectLine?.(mode, line, lat, lng)) ?? false
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
              {t('search.lineNotRunning', { line: lineNotRunning })}
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
            title={t('search.swap')}
            aria-label={t('search.swap')}
            className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/2 z-10 w-7 h-7 rounded-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 shadow-md flex items-center justify-center text-gray-500 dark:text-gray-300 hover:text-blue-700 dark:hover:text-blue-400 hover:border-blue-300 dark:hover:border-blue-600"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0-4-4m4 4-4 4M16 17H4m0 0 4 4m-4-4 4-4" />
            </svg>
          </button>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-300 dark:border-gray-600">
            <LocationInput
              label={t('search.from')}
              placeholder={t('search.fromPlaceholder')}
              value={fromText}
              onChange={setFromText}
              allowMyLocation
              onSelect={({ name, lat, lng }) => {
                setFromText(name)
                const coords = { lat, lng }
                setFromCoords(coords)
                if (toCoords) handleSearch(coords, toCoords, name, toText)
              }}
            />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-300 dark:border-gray-600">
            <LocationInput
              label={t('search.to')}
              placeholder={t('search.toPlaceholder')}
              value={toText}
              onChange={setToText}
              onSelect={({ name, lat, lng }) => {
                setToText(name)
                const coords = { lat, lng }
                setToCoords(coords)
                if (fromCoords) handleSearch(fromCoords, coords, fromText, name)
              }}
              trailing={
                fromCoords && toCoords ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeFavorite) removeFavorite(activeFavorite.id)
                      else addFavorite(fromText, fromCoords.lat, fromCoords.lng, toText, toCoords.lat, toCoords.lng)
                    }}
                    title={activeFavorite ? t('search.removeFavorite') : t('search.saveFavorite')}
                    aria-label={activeFavorite ? t('search.removeFavorite') : t('search.saveFavorite')}
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
              aria-label={t('search.clearSearch')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {!hasInput && (homeWork.home || homeWork.work || favorites.length > 0 || recents.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {homeWork.home && (
            <HomeWorkChip
              slot="home"
              place={homeWork.home}
              canSet={!!toCoords}
              onSelect={() => handleHomeWorkClick('home')}
              onSet={() => handleSetHomeWork('home')}
              onClear={() => clearHomeWork('home')}
            />
          )}
          {homeWork.work && (
            <HomeWorkChip
              slot="work"
              place={homeWork.work}
              canSet={!!toCoords}
              onSelect={() => handleHomeWorkClick('work')}
              onSet={() => handleSetHomeWork('work')}
              onClear={() => clearHomeWork('work')}
            />
          )}
          {favorites.map((favorite) => (
            <FavoriteChip
              key={favorite.id}
              favorite={favorite}
              onSelect={() => handleFavoriteClick(favorite)}
              onRemove={() => removeFavorite(favorite.id)}
            />
          ))}
          {recents
            .filter((recent) => !findFavorite(recent.fromLat, recent.fromLng, recent.toLat, recent.toLng))
            .map((recent) => (
              <RecentChip
                key={recent.id}
                recent={recent}
                onSelect={() => handleRecentClick(recent)}
                onRemove={() => removeRecent(recent.id)}
              />
            ))}
        </div>
      )}
      {/* Once a destination is picked, offer to save it as Home/Work right
          there instead of only in the (now-hidden) quick-pick row above. */}
      {hasInput && toCoords && (!homeWork.home || !homeWork.work) && (
        <div className="flex flex-wrap gap-1.5">
          {!homeWork.home && (
            <HomeWorkChip
              slot="home"
              canSet
              onSelect={() => {}}
              onSet={() => handleSetHomeWork('home')}
              onClear={() => {}}
            />
          )}
          {!homeWork.work && (
            <HomeWorkChip
              slot="work"
              canSet
              onSelect={() => {}}
              onSet={() => handleSetHomeWork('work')}
              onClear={() => {}}
            />
          )}
        </div>
      )}
      {/* Departure time selector + city selector */}
      <div className="flex items-center gap-2">
        {pickerVisible ? (
          <div className="flex items-center gap-1">
            <input
              type="datetime-local"
              value={dateTime}
              // Just track what's being typed -- the browser fires onChange
              // on every partial segment (day, then month, then year, ...),
              // so searching here would re-run mid-edit instead of once the
              // rider has actually picked a full date and time.
              onChange={(e) => setDateTime(e.target.value)}
              className="px-2 py-3 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-full text-base sm:text-xs shadow-md"
            />
            {dateTime && (
              <button
                type="button"
                onClick={() => {
                  setPickerVisible(false)
                  if (fromCoords && toCoords) {
                    handleSearch(fromCoords, toCoords, fromText, toText, dateTime, timeMode === 'arrive')
                  }
                }}
                className="px-3 py-3 bg-blue-600 text-white rounded-full text-xs font-medium shadow-md"
              >
                {t('search.done')}
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
                if (!dateTime) {
                  setPickerVisible(true)
                } else if (fromCoords && toCoords) {
                  handleSearch(fromCoords, toCoords, fromText, toText, dateTime, true)
                }
              } else {
                setTimeMode('now')
                setDateTime('')
                if (fromCoords && toCoords) handleSearch(fromCoords, toCoords, fromText, toText, '', false)
              }
            }}
            className={`px-4 py-3 rounded-full text-sm shadow-md border ${timeMode !== 'now' && dateTime ? 'bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 font-medium' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            {timeMode === 'now' && t('search.departNow')}
            {timeMode === 'depart' && (dateTime
              ? t('search.departTime', { time: new Date(dateTime).toLocaleString(localeTag(locale), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) })
              : t('search.departAt'))}
            {timeMode === 'arrive' && (dateTime
              ? t('search.arriveTime', { time: new Date(dateTime).toLocaleString(localeTag(locale), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) })
              : t('search.arriveAt'))}
          </button>
        )}
        {onWheelchairToggle && (
          <button
            type="button"
            onClick={() => {
              onWheelchairToggle()
              // OTP's own accessibility cost model already penalizes
              // unknown/inaccessible legs rather than banning them (see
              // otp/router-config.json), so toggling this can change which
              // itinerary comes back first even without touching from/to —
              // same "act immediately" pattern as the time-mode button.
              if (fromCoords && toCoords) handleSearch(fromCoords, toCoords, fromText, toText, dateTime, timeMode === 'arrive', !wheelchair)
            }}
            title={wheelchair ? t('search.wheelchairOn') : t('search.wheelchairOff')}
            aria-label={wheelchair ? t('search.wheelchairOn') : t('search.wheelchairOff')}
            aria-pressed={wheelchair}
            className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center shadow-md border ${wheelchair ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            <Accessibility size={20} />
          </button>
        )}
        <RiderProfileSelector />
        {activeCities && onCityToggle && onCountyToggle && onSetAllCities && (
          <CitySelector activeCities={activeCities} onToggle={onCityToggle} onToggleCounty={onCountyToggle} onSetAll={onSetAllCities} />
        )}
      </div>
      </>
      )}
    </div>
  )
}
