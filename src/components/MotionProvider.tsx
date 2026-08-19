'use client'

import { MotionConfig } from 'motion/react'

// Wraps the whole app so every spring/animation added via `motion` components
// automatically degrades to an instant change under prefers-reduced-motion,
// per the apple-design skill's reduced-motion guidance — no per-component
// media queries needed.
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
