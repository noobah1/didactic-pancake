'use client'

import { useState } from 'react'
import { X, Footprints, LocateFixed } from 'lucide-react'
import { StopInfo, StopDeparture } from '@/lib/types'
import { MODE_COLORS } from '@/lib/constants'
import { useCurrentLocation } from '@/hooks/use-current-location'

interface NearbyPanelProps {
  onClose: () => void
  onSelectStop: (stop: StopInfo) => void
}

interface NearbyStop extends StopInfo {
  nextDeparture?: StopDeparture
}

const WALK_METRES_PER_MINUTE = 80

async function fetchNextDeparture(stopId: string): Promise<StopDeparture | undefined> {
  try {
    const res = await fetch(`/api/stop-departures?stopId=${encodeURIComponent(stopId)}&n=1`)
    if (!res.ok) return undefined
    const data = await res.json()
    return data.departures?.[0]
  } catch {
    return undefined
  }
}

export function NearbyPanel({ onClose, onSelectStop }: NearbyPanelProps) {
  const { status, error: locError, locate } = useCurrentLocation()
  const [stops, setStops] = useState<NearbyStop[] | null>(null)
  const [loadingStops, setLoadingStops] = useState(false)

  // Geolocation is requested from this explicit button, not automatically on
  // open — a surprise permission prompt the moment the panel appears is bad
  // UX, and it matches the click-to-locate pattern LocationInput already uses.
  const handleFindNearby = async () => {
    const pos = await locate()
    if (!pos) return

    setLoadingStops(true)
    try {
      const res = await fetch(`/api/stops-nearby?lat=${pos.lat}&lng=${pos.lng}&radius=800&first=8`)
      if (!res.ok) return
      const data: { stops: StopInfo[] } = await res.json()
      setStops(data.stops)

      const withDepartures = await Promise.all(
        data.stops.map(async (stop) => ({
          ...stop,
          nextDeparture: await fetchNextDeparture(stop.stopId),
        })),
      )
      setStops(withDepartures)
    } finally {
      setLoadingStops(false)
    }
  }

  return (
    <div className="absolute bottom-32 right-4 z-30 w-72 max-h-[60vh] bg-white rounded-xl shadow-lg flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 text-white shrink-0">
        <span className="text-sm font-bold">Nearby stops</span>
        <button onClick={onClose} className="p-1 rounded-full hover:bg-white/20 transition-colors">
          <X size={18} />
        </button>
      </div>

      <div className="overflow-y-auto">
        {stops === null && (
          <div className="p-4 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={handleFindNearby}
              disabled={status === 'locating' || loadingStops}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-blue-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
            >
              <LocateFixed size={16} className={status === 'locating' ? 'animate-pulse' : ''} />
              {status === 'locating' ? 'Finding your location...' : loadingStops ? 'Looking for stops...' : 'Find nearby stops'}
            </button>
            {locError && <p className="text-xs text-amber-600 text-center">{locError}</p>}
          </div>
        )}

        {stops && stops.length === 0 && (
          <div className="p-4 text-center text-gray-400 text-sm">No stops within 800m</div>
        )}

        {stops && stops.length > 0 && (
          <div className="py-1">
            {stops.map((stop) => {
              const walkMinutes = Math.round((stop.distance ?? 0) / WALK_METRES_PER_MINUTE)
              const dep = stop.nextDeparture
              return (
                <button
                  key={stop.stopId}
                  type="button"
                  onClick={() => onSelectStop(stop)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{stop.name}</div>
                    <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-400">
                      <Footprints size={12} />
                      <span>{walkMinutes <= 0 ? '<1 min' : `${walkMinutes} min`}</span>
                    </div>
                  </div>
                  {dep ? (
                    <span
                      className="shrink-0 px-1.5 py-0.5 rounded text-xs font-bold text-white"
                      style={{ backgroundColor: MODE_COLORS[dep.mode] }}
                    >
                      {dep.line}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-gray-300">--</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
