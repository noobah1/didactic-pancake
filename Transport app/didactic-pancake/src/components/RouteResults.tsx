'use client'

import { useState } from 'react'
import { RouteResult } from '@/lib/types'
import { RouteCard } from './RouteCard'

type SortMode = 'duration' | 'departure'

interface RouteResultsProps {
  routes: RouteResult[]
  loading: boolean
  error: string | null
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function RouteResults({ routes, loading, error, selectedId, onSelect }: RouteResultsProps) {
  const [sortBy, setSortBy] = useState<SortMode>('duration')

  if (loading) {
    return <div className="p-4 text-center text-gray-500 text-sm bg-white rounded-xl shadow-lg mt-2">Searching routes...</div>
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-xl shadow-lg mt-2">
        <div className="flex items-start gap-3">
          <span className="text-red-500 text-xl flex-shrink-0">⚠️</span>
          <div className="flex-1">
            <p className="text-red-700 text-sm font-medium">{error}</p>
            {error.includes('OTP') && (
              <p className="text-red-600 text-xs mt-2">
                The route planning service is not available. Make sure your local OTP service is running.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (routes.length === 0) return null

  const sorted = [...routes].sort((a, b) =>
    sortBy === 'duration'
      ? a.duration - b.duration
      : new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  )

  return (
    <div className="flex flex-col max-h-52 bg-white rounded-xl shadow-lg mt-2">
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <h2 className="text-sm font-semibold text-gray-700">Routes</h2>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setSortBy('duration')}
            className={`px-2 py-1.5 text-xs rounded-full transition-colors ${sortBy === 'duration' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
          >
            Fastest
          </button>
          <button
            type="button"
            onClick={() => setSortBy('departure')}
            className={`px-2 py-1.5 text-xs rounded-full transition-colors ${sortBy === 'departure' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
          >
            Departure
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2 px-3 pb-3 overflow-y-auto">
      {sorted.map((route) => (
        <RouteCard
          key={route.id}
          route={route}
          selected={route.id === selectedId}
          onSelect={() => onSelect(route.id === selectedId ? null : route.id)}
        />
      ))}
      </div>
    </div>
  )
}
