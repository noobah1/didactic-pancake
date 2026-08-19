'use client'

import { motion } from 'motion/react'
import { X } from 'lucide-react'
import { AnimatedOverlay, TAP_SPRING } from '@/components/AnimatedOverlay'

interface DelayToastProps {
  text: string
  onDismiss: () => void
  onClick?: () => void
}

export function DelayToast({ text, onDismiss, onClick }: DelayToastProps) {
  return (
    <AnimatedOverlay
      anchor="bottom-right"
      onClick={onClick}
      className={`absolute bottom-24 right-4 z-40 max-w-[240px] flex items-start gap-2 px-3 py-2.5 bg-amber-500 text-white rounded-xl shadow-lg text-sm font-medium ${onClick ? 'cursor-pointer' : ''}`}
    >
      <span className="flex-1">{text}</span>
      <motion.button
        onClick={(e) => {
          e.stopPropagation()
          onDismiss()
        }}
        whileTap={{ scale: 0.85 }}
        transition={TAP_SPRING}
        className="shrink-0 p-0.5 rounded-full hover:bg-white/20 transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </motion.button>
    </AnimatedOverlay>
  )
}
