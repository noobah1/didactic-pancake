'use client'

import { useState, useRef, useEffect, useId } from 'react'
import {
  MapPin, Bus, TrainFront, Ship, TramFront,
  UtensilsCrossed, Coffee, Sandwich, Martini, Beer, Croissant,
  ShoppingCart, Store, ShoppingBag, Cpu, Hammer, BookOpen, Wine,
  Scissors, Sparkles, Glasses, Dumbbell, Waves, Trophy, Pill, Cross,
  HeartPulse, Stethoscope, Smile, PawPrint, Landmark, CreditCard, Mail,
  Clapperboard, Drama, Building2, Library, Disc3, Trees, BedDouble, Bed,
  House, Building, BedSingle,
  Fuel, BatteryCharging, SquareParking, Shield, School, GraduationCap, Baby,
  type LucideIcon,
} from 'lucide-react'
import { useGeocode, GeoResult } from '@/hooks/use-geocode'
import { useTranslation } from '@/lib/i18n/context'
import { evaluateOpeningHours } from '@/lib/opening-hours'
import { placeCategoryBySlug, PlaceCategory } from '@/lib/place-categories'

// Keyed by PlaceCategory.icon (see src/lib/place-categories.ts) — every
// slug used there must have an entry here, or a place row silently falls
// back to the generic MapPin below.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  UtensilsCrossed, Coffee, Sandwich, Martini, Beer, Croissant,
  ShoppingCart, Store, ShoppingBag, Cpu, Hammer, BookOpen, Wine,
  Scissors, Sparkles, Glasses, Dumbbell, Waves, Trophy, Pill, Cross,
  HeartPulse, Stethoscope, Smile, PawPrint, Landmark, CreditCard, Mail,
  Clapperboard, Drama, Building2, Library, Disc3, Trees, BedDouble, Bed,
  House, Building, BedSingle,
  Fuel, BatteryCharging, SquareParking, Shield, School, GraduationCap, Baby,
}

const LINE_MODE_ICONS: Record<string, LucideIcon> = {
  bus: Bus, tram: TramFront, train: TrainFront, ferry: Ship,
}

// Resolves purely from what /api/geocode already returns — no extra data
// needed. Falls through kind-by-kind (place -> line -> stop -> address)
// since the fields are mutually exclusive by construction (see GeoResult).
function iconFor(result: GeoResult, category: PlaceCategory | undefined): LucideIcon {
  if (result.placeCategory) return (category && CATEGORY_ICONS[category.icon]) || MapPin
  if (result.line && result.mode) return LINE_MODE_ICONS[result.mode] || Bus
  if (result.stopId) return Bus // stops don't expose their own mode to the client (see GeoResult) — one generic transit glyph covers all of them
  return MapPin
}

interface OpenBadgeProps {
  spec: string
}

function OpenBadge({ spec }: OpenBadgeProps) {
  const { t } = useTranslation()
  const state = evaluateOpeningHours(spec, new Date())
  if (state.state === 'unknown') return null // never guess — see opening-hours.ts

  if (state.state === 'open') {
    // Amber once it's closing soon (<=30min) rather than a flat green right
    // up to the last minute — the same "about to change" signal riders
    // already get elsewhere in this app (see DelayBanner's own thresholds).
    const minutesLeft = state.closesInMinutes
    const closingSoon = minutesLeft !== undefined && minutesLeft <= 30
    const text = closingSoon ? t('places.closesIn', { n: minutesLeft ?? 0 }) : state.closesAt ? t('places.openUntil', { time: state.closesAt }) : ''
    return (
      <span className={`shrink-0 ${closingSoon ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
        {text}
      </span>
    )
  }

  return (
    <span className="shrink-0 text-red-500 dark:text-red-400">
      {state.opensAt ? t('places.closedOpensAt', { time: state.opensAt }) : t('places.closed')}
    </span>
  )
}

interface LocationInputProps {
  label: string
  placeholder: string
  value: string
  onSelect: (result: GeoResult) => void
  onChange: (value: string) => void
  allowMyLocation?: boolean
  // Restricts search (and results) to transit stops only — used by the
  // departure-board search, which needs a stopId to look departures up by;
  // a plain address has no such thing.
  stopsOnly?: boolean
  // The rider's currently-selected cities — biases stop-name search results
  // toward them (see useGeocode). Omit when there's no meaningful city
  // context (e.g. this input isn't stop search at all).
  cityIds?: string[]
  // Rendered in the same row as the input, after it — e.g. the favorite
  // star toggle, kept next to the field it actually applies to instead of
  // off in the search panel's separate action-button column.
  trailing?: React.ReactNode
}

export function LocationInput({
  label,
  placeholder,
  value,
  onSelect,
  onChange,
  allowMyLocation,
  stopsOnly,
  cityIds,
  trailing,
}: LocationInputProps) {
  const { t } = useTranslation()
  const [showDropdown, setShowDropdown] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)
  const { results, search, clear } = useGeocode(stopsOnly, cityIds)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  // A fresh result list invalidates whatever the rider was arrow-keying
  // toward — re-highlighting index 0 of a completely different list (or an
  // index past its new, possibly shorter, length) would silently select the
  // wrong thing on the next Enter. Reset during render (React's own
  // documented pattern for "adjust state when a dependency changes without
  // an extra render/effect round-trip") rather than in a useEffect, which
  // would trigger a cascading re-render for a value that's cheap to compute
  // as we go.
  const [prevResults, setPrevResults] = useState(results)
  if (prevResults !== results) {
    setPrevResults(results)
    if (activeIndex !== -1) setActiveIndex(-1)
  }

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
    onSelect(result)
    setShowDropdown(false)
    clear()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (activeIndex < 0) return // no highlighted option yet — let Enter do nothing rather than guess
      e.preventDefault()
      handleSelect(results[activeIndex])
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
      setActiveIndex(-1)
    }
  }

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setLocateError(t('location.geolocationUnsupported'))
      return
    }
    setLocating(true)
    setLocateError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        onSelect({ name: t('location.myLocation'), lat: position.coords.latitude, lng: position.coords.longitude })
        setShowDropdown(false)
        clear()
      },
      (error) => {
        setLocating(false)
        setLocateError(error.code === error.PERMISSION_DENIED ? t('location.locationDenied') : t('location.locationUnavailable'))
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
          onKeyDown={handleKeyDown}
          placeholder={`${label}: ${placeholder}`}
          role="combobox"
          aria-expanded={showDropdown && results.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          className="w-full px-3 py-3 text-base sm:text-sm focus:outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
        {allowMyLocation && (
          <button
            type="button"
            onClick={handleUseMyLocation}
            disabled={locating}
            title={t('location.useMyLocation')}
            aria-label={t('location.useMyLocation')}
            className="shrink-0 mr-2 p-1.5 text-gray-400 hover:text-blue-700 dark:hover:text-blue-400 disabled:opacity-50"
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
        {trailing}
      </div>
      {locateError && (
        <p className="absolute z-50 w-full mt-1 px-3 py-1.5 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 text-xs rounded-lg border border-red-200 dark:border-red-800">
          {locateError}
        </p>
      )}
      {showDropdown && results.length > 0 && (
        <ul id={listboxId} role="listbox" className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {results.map((r, i) => {
            const category = r.placeCategory ? placeCategoryBySlug(r.placeCategory) : undefined
            const Icon = iconFor(r, category)
            return (
              <li key={i}>
                <button
                  type="button"
                  id={`${listboxId}-option-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  onClick={() => handleSelect(r)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`w-full flex items-start gap-2 px-3 py-2 text-left ${i === activeIndex ? 'bg-gray-100 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >
                  <Icon size={16} className="shrink-0 mt-0.5 text-gray-400 dark:text-gray-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-900 dark:text-gray-100">{r.name}</span>
                    {r.placeDetail && (
                      <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                        <span className="truncate">{r.placeDetail}</span>
                        {r.openingHours && <OpenBadge spec={r.openingHours} />}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
