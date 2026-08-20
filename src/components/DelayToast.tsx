'use client'

import { X } from 'lucide-react'

interface DelayToastProps {
  text: string
  onDismiss: () => void
  onClick?: () => void
}

export function DelayToast({ text, onDismiss, onClick }: DelayToastProps) {
  return (
    <div
      onClick={onClick}
      className={`absolute bottom-24 right-4 z-40 max-w-[240px] flex items-start gap-2 px-3 py-2.5 bg-amber-500 text-white rounded-xl shadow-lg text-sm font-medium ${onClick ? 'cursor-pointer' : ''}`}
    >
      <span className="flex-1">{text}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onDismiss()
        }}
        className="shrink-0 p-0.5 rounded-full hover:bg-white/20 transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}
