'use client'

import { AlertTriangle } from 'lucide-react'

interface IncidentButtonProps {
  active: boolean
  alertCount: number
  onClick: () => void
}

export function IncidentButton({ active, alertCount, onClick }: IncidentButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`absolute right-3 bottom-6 z-10 w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all border-2 ${
        active
          ? 'bg-amber-100 border-red-500'
          : 'bg-white/90 border-gray-300 hover:bg-gray-100'
      }`}
      title={active ? 'Hide incidents' : `Show incidents (${alertCount})`}
    >
      <AlertTriangle
        size={20}
        fill={alertCount > 0 ? '#FBBF24' : 'none'}
        stroke={alertCount > 0 ? '#EF4444' : '#9CA3AF'}
        strokeWidth={2}
      />
      {alertCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
          {alertCount > 9 ? '9+' : alertCount}
        </span>
      )}
    </button>
  )
}
