'use client'

import { Navigation } from 'lucide-react'

interface NearbyButtonProps {
  active: boolean
  onClick: () => void
}

export function NearbyButton({ active, onClick }: NearbyButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all border-2 ${
        active
          ? 'bg-blue-100 border-blue-500'
          : 'bg-white/90 border-gray-300 hover:bg-gray-100'
      }`}
      title={active ? 'Hide nearby stops' : 'Show nearby stops'}
    >
      <Navigation size={22} stroke={active ? '#2563EB' : '#374151'} strokeWidth={2} />
    </button>
  )
}
