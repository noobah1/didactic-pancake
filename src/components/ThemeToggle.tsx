'use client'

import { Sun, Moon } from 'lucide-react'
import { ThemePreference } from '@/hooks/use-theme'

interface ThemeToggleProps {
  preference: ThemePreference
  onChange: (pref: ThemePreference) => void
}

export function ThemeToggle({ preference, onChange }: ThemeToggleProps) {
  const isDark = preference === 'dark'
  const Icon = isDark ? Moon : Sun

  return (
    <button
      onClick={() => onChange(isDark ? 'light' : 'dark')}
      className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all border-2 border-transparent bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      <Icon size={22} className="text-gray-600 dark:text-gray-300" strokeWidth={2} />
    </button>
  )
}
