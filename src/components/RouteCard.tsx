'use client'

import { RouteResult } from '@/lib/types'
import { MODE_COLORS } from '@/lib/constants'

interface RouteCardProps {
  route: RouteResult
  selected: boolean
  onSelect: () => void
}

export function RouteCard({ route, selected, onSelect }: RouteCardProps) {
  const transitLegs = route.legs.filter((l) => l.mode !== 'walk')
  const totalMinutes = Math.round(route.duration / 60)
  const startTime = new Date(route.startTime).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  const maxDelay = Math.max(...route.legs.map((l) => l.delay || 0))
  const delayMinutes = Math.round(maxDelay / 60)

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-lg border transition-colors ${
        selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {transitLegs.map((leg, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-gray-400 text-xs">&rarr;</span>}
              <span
                className="px-2 py-0.5 rounded text-xs font-bold text-white"
                style={{ backgroundColor: MODE_COLORS[leg.mode === 'walk' ? 'bus' : leg.mode] }}
              >
                {leg.route || leg.mode}
              </span>
            </span>
          ))}
        </div>
        <span className="font-bold text-sm">{totalMinutes} min</span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-gray-500">Depart {startTime}</span>
        {delayMinutes > 0 ? (
          <span className="text-xs text-amber-600 font-medium">{delayMinutes}min delay</span>
        ) : (
          <span className="text-xs text-green-600 font-medium">on time</span>
        )}
      </div>
    </button>
  )
}
