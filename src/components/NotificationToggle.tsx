'use client'

import { Bell, BellOff } from 'lucide-react'

interface NotificationToggleProps {
  enabled: boolean
  busy: boolean
  onToggle: () => void
}

export function NotificationToggle({ enabled, busy, onToggle }: NotificationToggleProps) {
  const Icon = enabled ? Bell : BellOff

  return (
    <button
      onClick={onToggle}
      disabled={busy}
      className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all border-2 border-transparent bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
      title={enabled ? 'Turn off delay notifications' : 'Notify me about delays on my favorites'}
    >
      <Icon
        size={22}
        className={enabled ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}
        strokeWidth={2}
      />
    </button>
  )
}
