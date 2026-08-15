'use client'

import { useCallback, useEffect, useState } from 'react'

// No "follow device" mode — the app used to default to it, but a phone's
// own night-schedule dark mode meant this app went dark right along with
// it, unannounced, which read as broken rather than intentional. Defaults
// to light and only changes on an explicit manual toggle now.
export type ThemePreference = 'light' | 'dark'

const STORAGE_KEY = 'theme'

function applyTheme(pref: ThemePreference) {
  document.documentElement.classList.toggle('dark', pref === 'dark')
  // Keep the browser chrome (address bar on mobile) matching — layout.tsx's
  // static viewport export only covers the initial light default.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', pref === 'dark' ? '#0f172a' : '#1D4ED8')
}

// Kept in sync with the inline script in layout.tsx, which sets the class
// before first paint (avoiding a flash of the wrong theme) — this hook picks
// up whatever that script already applied rather than re-deciding from
// scratch, then keeps it live afterward on manual toggles.
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>('light')

  useEffect(() => {
    // Read the real stored preference after mount, not as the initial state
    // value — the layout's inline script already applied the right class
    // before paint using the same localStorage key, but reading it directly
    // as useState's initial value here would run during SSR too (no
    // localStorage there) and mismatch the client's first hydration pass.
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreferenceState(stored === 'dark' ? 'dark' : 'light')
  }, [])

  useEffect(() => {
    applyTheme(preference)
  }, [preference])

  const setPreference = useCallback((pref: ThemePreference) => {
    localStorage.setItem(STORAGE_KEY, pref)
    setPreferenceState(pref)
  }, [])

  return { preference, setPreference }
}
