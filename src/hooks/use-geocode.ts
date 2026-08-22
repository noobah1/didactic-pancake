import { useState, useCallback, useRef } from 'react'
import { useTranslation } from '@/lib/i18n/context'

interface GeoResult {
  name: string
  lat: number
  lng: number
  stopId?: string
  // Only present for a line match (stopsOnly search only — see /api/geocode)
  // — mutually exclusive with stopId. Selecting one means "show this line",
  // not "open a departure board".
  line?: string
  mode?: 'train' | 'ferry' | 'bus' | 'tram'
}

// cityIds: the rider's currently-selected cities (CityDef.id), passed
// through to /api/geocode so a stop search can break ties toward the city
// the rider is actually looking at — a search for a name that exists in
// several towns (e.g. "Lille", present in Tallinn/Tartu/Elva/Kuressaare)
// otherwise has no way to prefer the relevant one. Omit or pass none-
// selected/all-selected to search nationwide with no city bias.
export function useGeocode(stopsOnly = false, cityIds: string[] = []) {
  const { locale } = useTranslation()
  const [results, setResults] = useState<GeoResult[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Read inside the debounced callback rather than captured in the
  // useCallback's own deps — cityIds is typically a fresh array each render
  // (activeCities.map(...) at the call site), and depending on it directly
  // would redefine `search` (and reset any in-flight debounce) every render.
  const cityIdsRef = useRef(cityIds)
  cityIdsRef.current = cityIds
  const localeRef = useRef(locale)
  localeRef.current = locale

  const search = useCallback((query: string) => {
    clearTimeout(debounceRef.current)

    // Mirrors /api/geocode's own minimum: 2 characters for a general place
    // search, but a single character is allowed for stopsOnly (the
    // departure-board search) since a one-digit line code ("1", "2", "5"...)
    // is a complete, deliberate query on its own — requiring 2 would make
    // the single most common class of line search unreachable.
    if (query.length < (stopsOnly ? 1 : 2)) {
      setResults([])
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ q: query, lang: localeRef.current })
        if (stopsOnly) params.set('type', 'stop')
        if (cityIdsRef.current.length > 0) params.set('cities', cityIdsRef.current.join(','))
        const res = await fetch(`/api/geocode?${params}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setResults(data.results || [])
      } catch (error) {
        console.error('Geocode error:', error)
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [stopsOnly])

  const clear = useCallback(() => setResults([]), [])

  return { results, loading, search, clear }
}
