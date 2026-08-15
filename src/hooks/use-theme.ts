'use client'

import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(pref: ThemePreference) {
  const dark = pref === 'dark' || (pref === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', dark)
}

// Kept in sync with the inline script in layout.tsx, which sets the class
// before first paint (avoiding a flash of the wrong theme) — this hook picks
// up whatever that script already applied rather than re-deciding from
// scratch, then keeps it live afterward (toggle changes, OS scheme changes).
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>('system')

  useEffect(() => {
    // Read the real stored preference after mount, not as the initial state
    // value — the layout's inline script already applied the right class
    // before paint using the same localStorage key, but reading it directly
    // as useState's initial value here would run during SSR too (no
    // localStorage there) and mismatch the client's first hydration pass.
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreferenceState(stored ?? 'system')
  }, [])

  useEffect(() => {
    applyTheme(preference)
    if (preference !== 'system') return

    // "Follow the device" isn't a one-time read — the OS/browser can flip
    // its own scheme (day/night schedule, manual toggle) while the app
    // stays open, and the app should track that live, not just at load.
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preference])

  const setPreference = useCallback((pref: ThemePreference) => {
    localStorage.setItem(STORAGE_KEY, pref)
    setPreferenceState(pref)
  }, [])

  return { preference, setPreference }
}
