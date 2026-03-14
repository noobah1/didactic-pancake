import { useState, useCallback, useRef } from 'react'

interface GeoResult {
  name: string
  lat: number
  lng: number
}

export function useGeocode() {
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
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`)
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
  }, [])

  const clear = useCallback(() => setResults([]), [])

  return { results, loading, search, clear }
}