import { useState, useCallback } from 'react'
import { RouteResult, TransportMode } from '@/lib/types'

interface PlanResponse {
  routes: RouteResult[]
  error?: string
  details?: string
}

async function geocodeAddress(addressName: string): Promise<{ lat: number; lng: number } | null> {
  try {
    console.log('🔍 Geocoding address:', addressName)
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addressName)}&format=json&limit=5&countrycodes=ee`,
      {
        headers: {
          'Accept-Language': 'et',
          'User-Agent': 'TransportApp/1.0'
        }
      }
    )
    
    if (!res.ok) {
      console.warn('❌ Geocode API response not OK:', res.status)
      return null
    }
    
    const data = await res.json()
    console.log('📍 Geocode results:', data)
    
    if (Array.isArray(data) && data[0]) {
      const result = {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      }
      console.log('✅ Geocoded successfully:', result)
      return result
    }
    
    console.warn('❌ No results from Nominatim for:', addressName)
    return null
  } catch (error) {
    console.error('❌ Geocoding error:', error)
    return null
  }
}

export function useRoutePlan() {
  const [routes, setRoutes] = useState<RouteResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = useCallback(
    async (fromPlace: string, toPlace: string, modes: TransportMode[], dateTime?: string, arriveBy?: boolean) => {
      setLoading(true)
      setError(null)

      try {
        // Parse format: "AddressName,lat,lng" - name can contain commas, coords are always at the end
        const parsePlace = (placeStr: string) => {
          console.log('📍 Parsing place string:', placeStr)
          const parts = placeStr.split(',')
          
          if (parts.length < 3) {
            console.warn('⚠️ Not enough parts, treating as address name:', placeStr)
            return { name: placeStr, lat: 0, lng: 0 }
          }
          
          // Last two elements should be lat and lng
          const lat = parseFloat(parts[parts.length - 2])
          const lng = parseFloat(parts[parts.length - 1])
          
          // Check if we got valid numbers, if not treat whole string as name
          if (isNaN(lat) || isNaN(lng)) {
            console.warn('⚠️ Invalid coordinates, treating whole string as address:', placeStr)
            return { name: placeStr, lat: 0, lng: 0 }
          }
          
          // Everything before last two elements is the address name (join back with commas)
          const name = parts.slice(0, -2).join(',')
          console.log('✅ Parsed:', { name, lat, lng })
          
          return { name, lat, lng }
        }

        let from = parsePlace(fromPlace)
        let to = parsePlace(toPlace)

        console.log('🚀 Initial from:', from, 'to:', to)

        // If coordinates are missing/zero, attempt to geocode the address name
        if ((from.lat === 0 || from.lng === 0) && from.name.trim()) {
          console.log('🔄 From has zero coords, attempting to geocode:', from.name)
          const geocoded = await geocodeAddress(from.name)
          if (geocoded) {
            from = { ...from, ...geocoded }
            console.log('✅ From geocoded:', from)
          } else {
            console.warn('❌ Could not geocode from:', from.name)
          }
        }

        if ((to.lat === 0 || to.lng === 0) && to.name.trim()) {
          console.log('🔄 To has zero coords, attempting to geocode:', to.name)
          const geocoded = await geocodeAddress(to.name)
          if (geocoded) {
            to = { ...to, ...geocoded }
            console.log('✅ To geocoded:', to)
          } else {
            console.warn('❌ Could not geocode to:', to.name)
          }
        }

        console.log('📌 Final coords - from:', from, 'to:', to)

        // Final validation
        if (from.lat === 0 || from.lng === 0 || to.lat === 0 || to.lng === 0) {
          const missingFrom = (from.lat === 0 || from.lng === 0) ? `From: "${from.name}"` : ''
          const missingTo = (to.lat === 0 || to.lng === 0) ? `To: "${to.name}"` : ''
          setError(
            `Could not find coordinates for:\n${[missingFrom, missingTo].filter(Boolean).join('\n')}\n\nPlease try:\n• Spelling the address differently\n• Using a nearby landmark or street name\n• Checking both addresses are in Estonia`
          )
          setRoutes([])
          setLoading(false)
          return
        }

        const params = new URLSearchParams({
          fromPlace: `${from.lat},${from.lng}`,
          toPlace: `${to.lat},${to.lng}`,
          modes: modes.join(','),
          ...(dateTime ? { dateTime } : {}),
          ...(arriveBy ? { arriveBy: 'true' } : {}),
        })

        const res = await fetch(`/api/plan?${params}`, {
          signal: AbortSignal.timeout(15000),
        })
        const data: PlanResponse = await res.json()

        if (!res.ok) {
          if (data.error?.includes('OTP') || data.error?.includes('service')) {
            setError('Route planning service is not available. Please check that the OTP service is running.')
          } else if (data.error?.includes('No routes')) {
            setError('No routes found between these locations. Try different addresses or transport modes.')
          } else {
            setError(data.error || 'Failed to plan route')
          }
          setRoutes([])
        } else if (data.error) {
          setError(data.error)
          setRoutes([])
        } else if (data.routes) {
          setRoutes(data.routes)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('timeout') || msg.includes('ECONNREFUSED')) {
          setError('Route planning service is not responding. Make sure the OTP service is running at http://localhost:8080')
        } else if (msg.includes('AbortError')) {
          setError('Request timed out. The route planning service took too long to respond.')
        } else {
          setError('Failed to connect to route planning service')
        }
        setRoutes([])
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const clear = useCallback(() => {
    setRoutes([])
    setError(null)
  }, [])

  return { routes, loading, error, search, clear }
}
