'use client'

import { RouteResult } from '@/lib/types'
import { RouteCard } from './RouteCard'

interface RouteResultsProps {
  routes: RouteResult[]
  loading: boolean
  error: string | null
  selectedId: string | null
  onSelect: (id: string) => void
}

export function RouteResults({ routes, loading, error, selectedId, onSelect }: RouteResultsProps) {
  if (loading) {
    return <div className="p-4 text-center text-gray-500 text-sm">Searching routes...</div>
  }

  if (error) {
    return <div className="p-4 text-center text-red-500 text-sm">{error}</div>
  }

  if (routes.length === 0) return null

  return (
    <div className="flex flex-col gap-2 p-4 overflow-y-auto max-h-96">
      {routes.map((route) => (
        <RouteCard
          key={route.id}
          route={route}
          selected={route.id === selectedId}
          onSelect={() => onSelect(route.id)}
        />
      ))}
    </div>
  )
}
