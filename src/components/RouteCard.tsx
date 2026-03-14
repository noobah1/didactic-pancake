'use client'

import { useState } from 'react'
import { Footprints } from 'lucide-react'
import { RouteResult, RouteLeg } from '@/lib/types'
import { MODE_COLORS, MODE_LABELS } from '@/lib/constants'

interface RouteCardProps {
  route: RouteResult
  selected: boolean
  onSelect: () => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Tallinn' })
}

function ExpandableLeg({ leg }: { leg: RouteLeg }) {
  const [expanded, setExpanded] = useState(false)
  const color = MODE_COLORS[leg.mode as keyof typeof MODE_COLORS] || '#6B7280'
  const stops = leg.intermediateStops || []

  return (
    <div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
        className="w-full flex items-center justify-between py-1.5 text-left"
      >
        <div className="flex items-center gap-2">
          <span
            className="px-1.5 py-0.5 rounded text-xs font-bold text-white"
            style={{ backgroundColor: color }}
          >
            {leg.route || leg.mode}
          </span>
          <span className="text-xs text-gray-500">{formatTime(leg.startTime)}</span>
          <span className="text-xs text-gray-600">{leg.from.name} &rarr; {leg.to.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400">{Math.round(leg.duration / 60)} min</span>
          {stops.length > 0 && (
            <svg
              className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
            </svg>
          )}
        </div>
      </button>
      {expanded && stops.length > 0 && (
        <div className="ml-1 pl-2 border-l-2 mb-1" style={{ borderColor: color }}>
          <div className="flex items-center gap-2 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-xs font-medium">{formatTime(leg.startTime)}</span>
            <span className="text-xs text-gray-600">{leg.from.name}</span>
          </div>
          {stops.map((stop, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <span className="w-1 h-1 rounded-full bg-gray-400" />
              <span className="text-xs text-gray-400">{stop.departure ? formatTime(stop.departure) : ''}</span>
              <span className="text-xs text-gray-500">{stop.name}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-xs font-medium">{formatTime(leg.endTime)}</span>
            <span className="text-xs text-gray-600">{leg.to.name}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function RouteCard({ route, selected, onSelect }: RouteCardProps) {
  const transitLegs = route.legs.filter((l) => l.mode !== 'walk')
  const totalMinutes = Math.round(route.duration / 60)
  const startTime = formatTime(route.startTime)
  const endTime = formatTime(route.endTime)
  const maxDelay = Math.max(...route.legs.map((l) => l.delay || 0))
  const delayMinutes = Math.round(maxDelay / 60)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect() }}
      className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${
        selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {transitLegs.length === 0 ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-gray-400 text-white">
              <Footprints size={12} />
              <span className="text-xs font-bold">Walk</span>
            </span>
          ) : (
            transitLegs.map((leg, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-gray-400 text-xs">&rarr;</span>}
                <span
                  className="px-2 py-0.5 rounded text-xs font-bold text-white"
                  style={{ backgroundColor: MODE_COLORS[leg.mode === 'walk' ? 'bus' : leg.mode] }}
                  title={MODE_LABELS[leg.mode === 'walk' ? 'bus' : leg.mode]}
                >
                  {leg.route || leg.mode}
                </span>
              </span>
            ))
          )}
        </div>
        <span className="font-bold text-sm">{totalMinutes} min</span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-gray-500">{startTime} &rarr; {endTime}</span>
        {transitLegs.length > 0 && (
          delayMinutes > 0 ? (
            <span className="text-xs text-amber-600 font-medium">{delayMinutes}min delay</span>
          ) : (
            <span className="text-xs text-green-600 font-medium">on time</span>
          )
        )}
      </div>
      {selected && (
        <div className="mt-2 flex flex-col divide-y divide-gray-100">
          {route.legs.map((leg, i) => (
            <div key={i}>
              {leg.mode === 'walk' ? (
                <div className="flex items-center gap-2 py-1.5 text-xs text-gray-400">





                  <Footprints size={14} />
                  <span>Walk {Math.round(leg.duration / 60)} min</span>
                </div>
              ) : (
                <ExpandableLeg leg={leg} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
