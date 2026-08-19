'use client'

import { motion } from 'motion/react'
import { LocateFixed } from 'lucide-react'
import { TAP_SPRING } from '@/components/AnimatedOverlay'

interface NearbyButtonProps {
  active: boolean
  onClick: () => void
}

export function NearbyButton({ active, onClick }: NearbyButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      aria-label={active ? 'Hide nearby stops' : 'Show nearby stops'}
      whileTap={{ scale: 0.9 }}
      transition={TAP_SPRING}
      className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors border-2 backdrop-blur-xl ${
        active
          ? 'bg-blue-100/90 dark:bg-blue-900/80 border-blue-500'
          : 'bg-white/85 dark:bg-gray-900/80 border-transparent hover:bg-gray-50 dark:hover:bg-gray-700'
      }`}
      title={active ? 'Hide nearby stops' : 'Nearby stops'}
    >
      <LocateFixed
        size={22}
        strokeWidth={2}
        className={active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-300'}
      />
    </motion.button>
  )
}
