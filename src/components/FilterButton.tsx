'use client'

import { useRef } from 'react'
import { ListFilter } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/context'

interface FilterButtonProps {
  // A filter is currently applied to the map (not just armed/available).
  active: boolean
  // The line number to show as a badge — the applied filter's line if any,
  // otherwise whatever line was last searched/tapped and is ready to apply.
  armedLine: string | null
  // Short tap: apply/clear the armed filter.
  onToggle: () => void
  // Long-press or right-click: open the line picker panel.
  onOpenPanel: () => void
}

const LONG_PRESS_MS = 500

export function FilterButton({ active, armedLine, onToggle, onOpenPanel }: FilterButtonProps) {
  const { t } = useTranslation()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didLongPressRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const startPress = () => {
    didLongPressRef.current = false
    clearTimer()
    timerRef.current = setTimeout(() => {
      didLongPressRef.current = true
      onOpenPanel()
    }, LONG_PRESS_MS)
  }

  const endPress = () => {
    clearTimer()
  }

  const handleClick = () => {
    // The long-press timer already fired onOpenPanel — the pointerup/click
    // that follows the release shouldn't also toggle the filter.
    if (didLongPressRef.current) {
      didLongPressRef.current = false
      return
    }
    if (armedLine) {
      onToggle()
    } else {
      onOpenPanel()
    }
  }

  const label = active
    ? t('filterButton.hide')
    : armedLine
      ? t('filterButton.show', { line: armedLine })
      : t('filterButton.open')

  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onContextMenu={(e) => {
        e.preventDefault()
        onOpenPanel()
      }}
      aria-label={label}
      title={label}
      className={`relative w-14 h-14 rounded-full shadow-lg flex items-center justify-center border-2 backdrop-blur-xl ${
        active
          ? 'bg-blue-100/90 dark:bg-blue-900/80 border-blue-500'
          : 'bg-white/85 dark:bg-gray-900/80 border-transparent hover:bg-gray-50 dark:hover:bg-gray-700'
      }`}
    >
      <ListFilter
        size={22}
        strokeWidth={2}
        className={active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-300'}
      />
      {armedLine && (
        <span className="absolute -top-1 -right-1 bg-gray-600 dark:bg-gray-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
          {armedLine.length > 3 ? armedLine.slice(0, 3) : armedLine}
        </span>
      )}
    </button>
  )
}
