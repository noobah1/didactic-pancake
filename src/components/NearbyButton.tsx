'use client'

import { LocateFixed } from 'lucide-react'

interface NearbyButtonProps {
  active: boolean
  onClick: () => void
}

export function NearbyButton({ active, onClick }: NearbyButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={active ? 'Hide nearby stops' : 'Show nearby stops'}
      className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all border-2 ${
        active
          ? 'bg-blue-100 dark:bg-blue-900 border-blue-500'
          : 'bg-white dark:bg-gray-800 border-transparent hover:bg-gray-50 dark:hover:bg-gray-700'
      }`}
      title={active ? 'Hide nearby stops' : 'Nearby stops'}
    >
      <LocateFixed
        size={22}
        strokeWidth={2}
        className={active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-300'}
      />
    </button>
  )
}
