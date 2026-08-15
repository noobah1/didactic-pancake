'use client'

import { Sun, Moon, MonitorSmartphone } from 'lucide-react'
import { ThemePreference } from '@/hooks/use-theme'

interface ThemeToggleProps {
  preference: ThemePreference
  onChange: (pref: ThemePreference) => void
}

const NEXT: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
}

const ICON = {
  system: MonitorSmartphone,
  light: Sun,
  dark: Moon,
}

const LABEL = {
  system: 'Matching device',
  light: 'Light',
  dark: 'Dark',
}

export function ThemeToggle({ preference, onChange }: ThemeToggleProps) {
  const Icon = ICON[preference]

  return (
    <button
      onClick={() => onChange(NEXT[preference])}
      className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all border-2 border-transparent bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
      title={`Theme: ${LABEL[preference]} (click to change)`}
    >
      <Icon size={22} className="text-gray-600 dark:text-gray-300" strokeWidth={2} />
    </button>
  )
}
