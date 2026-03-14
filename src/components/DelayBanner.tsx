'use client'

import { DelayWarning } from '@/hooks/use-journey-monitor'

interface DelayBannerProps {
  warnings: DelayWarning[]
  onGetAlternatives: () => void
  onDismiss: (legIndex: number) => void
}

export function DelayBanner({ warnings, onGetAlternatives, onDismiss }: DelayBannerProps) {
  if (warnings.length === 0) return null

  return (
    <div className="flex flex-col gap-1 mt-1">
      {warnings.map((warning) => (
        <div
          key={warning.legIndex}
          className="flex items-center justify-between gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-amber-500 text-base">⚠️</span>
            <span className="text-amber-800 font-medium">{warning.message}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onGetAlternatives}
              className="px-2 py-1 bg-amber-500 text-white rounded text-xs font-medium hover:bg-amber-600 transition-colors"
            >
              Alternatives
            </button>
            <button
              type="button"
              onClick={() => onDismiss(warning.legIndex)}
              className="px-2 py-1 text-amber-600 hover:text-amber-800 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
