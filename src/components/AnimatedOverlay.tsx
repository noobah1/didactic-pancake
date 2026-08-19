'use client'

import { motion } from 'motion/react'
import { forwardRef } from 'react'

type Anchor = 'bottom-right' | 'bottom-left' | 'top'

// Shared press-feedback spring for tap-scale buttons across the app — fast
// enough (well under 150ms) to read as instant per the skill's "respond on
// pointer-down" rule, since `whileTap` already fires on pointerdown.
export const TAP_SPRING = { type: 'spring', stiffness: 500, damping: 30 } as const

// Critically damped (no bounce) — these panels appear because the user
// tapped a button, not because they carried gesture momentum, so an
// overshoot would read as wrong per the apple-design skill's damping rule.
const SPRING = { type: 'spring', damping: 1, duration: 0.35 } as const

// Small offset + scale toward the corner the panel visually "came from",
// so it materializes near its trigger instead of just fading in place.
const OFFSETS: Record<Anchor, { x?: number; y?: number; origin: string }> = {
  'bottom-right': { y: 12, x: 8, origin: 'bottom right' },
  'bottom-left': { y: 12, x: -8, origin: 'bottom left' },
  top: { y: -10, origin: 'top center' },
}

interface AnimatedOverlayProps {
  anchor: Anchor
  className?: string
  onClick?: () => void
  children: React.ReactNode
}

export const AnimatedOverlay = forwardRef<HTMLDivElement, AnimatedOverlayProps>(
  function AnimatedOverlay({ anchor, className, onClick, children }, ref) {
    const { x = 0, y = 0, origin } = OFFSETS[anchor]

    return (
      <motion.div
        ref={ref}
        className={className}
        onClick={onClick}
        style={{ transformOrigin: origin }}
        initial={{ opacity: 0, scale: 0.92, x, y }}
        animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, x, y }}
        transition={SPRING}
      >
        {children}
      </motion.div>
    )
  },
)
