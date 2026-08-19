import { useState, useCallback, useRef } from 'react'

interface GeoResult {
  name: string
  lat: number
  lng: number
  stopId?: string
}

// cityIds: the rider's currently-selected cities (CityDef.id), passed
// through to /api/geocode so a stop search can break ties toward the city
// the rider is actually looking at — a search for a name that exists in
// several towns (e.g. "Lille", present in Tallinn/Tartu/Elva/Kuressaare)
// otherwise has no way to prefer the relevant one. Omit or pass none-
// selected/all-selected to search nationwide with no city bias.
export function useGeocode(stopsOnly = false, cityIds: string[] = []) {
  const [results, setResults] = useState<GeoResult[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Read inside the debounced callback rather than captured in the
  // useCallback's own deps — cityIds is typically a fresh array each render
  // (activeCities.map(...) at the call site), and depending on it directly
  // would redefine `search` (and reset any in-flight debounce) every render.
  const cityIdsRef = useRef(cityIds)
  cityIdsRef.current = cityIds

  const search = useCallback((query: string) => {
    clearTimeout(debounceRef.current)

    if (query.length < 2) {
      setResults([])
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ q: query })
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
