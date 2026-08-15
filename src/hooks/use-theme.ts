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

// Reads the class layout.tsx's inline script already applied before first
// paint, rather than defaulting to 'light' and correcting a tick after
// mount. That "start wrong, correct shortly after" pattern used to avoid a
// hydration-mismatch warning, but it's not just cosmetic here — MapView
// picks which basemap style to fetch from this value and remounts fully on
// a change (see its darkMode prop), so a late correction meant briefly
// mounting the wrong map, then immediately tearing it down and remounting
// while its style was still loading — the torn-down instance's load
// callback fired after the map was already removed and crashed. Reading
// the DOM directly on the client's first render is correct immediately, at
// the cost of an expected, deliberate hydration mismatch (suppressed with
// suppressHydrationWarning wherever this value drives rendered output).
function initialPreference(): ThemePreference {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference)

  useEffect(() => {
    applyTheme(preference)
  }, [preference])

  const setPreference = useCallback((pref: ThemePreference) => {
    localStorage.setItem(STORAGE_KEY, pref)
    setPreferenceState(pref)
  }, [])

  return { preference, setPreference }
}
