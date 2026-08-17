import { useState, useCallback, useRef } from 'react'

interface GeoResult {
  name: string
  lat: number
  lng: number
  stopId?: string
}

export function useGeocode(stopsOnly = false) {
  const [results, setResults] = useState<GeoResult[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

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
