'use client'

import { useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function applyTheme(pref: ThemePreference) {
  document.documentElement.classList.toggle('dark', pref === 'dark')
  // Keep the browser chrome (address bar on mobile) matching — layout.tsx's
  // static viewport export only covers the initial light default, and its
  // own inline script (see themeInitScript) sets this same value before
  // first paint so there's no flash before this effect runs.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', pref === 'dark' ? '#15202B' : '#1D4ED8')
}

// Reads the class layout.tsx's inline script already applied before first
// paint (from matchMedia, same query as below), rather than defaulting to
// 'light' and correcting a tick after mount. That "start wrong, correct
// shortly after" pattern used to avoid a hydration-mismatch warning, but
// it's not just cosmetic here — MapView reads this class directly to pick
// its canvas filter and marker colors, so a late correction would mean a
// visible flash from light to dark right after paint. Reading the DOM
// directly on the client's first render is correct immediately, at the
// cost of an expected, deliberate hydration mismatch (suppressed with
// suppressHydrationWarning wherever this value drives rendered output).
function initialPreference(): ThemePreference {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

// No manual toggle — the app follows the OS/browser's own light-or-dark
// setting and switches live when it changes, matching prefers-color-scheme
// rather than a remembered choice. (An earlier version defaulted to light
// and only changed on an explicit toggle, since a phone's own
// night-schedule dark mode carrying straight through felt like an
// unannounced, unintentional change — that concern is now addressed by
// dark mode itself being a deliberately soft "dim" theme rather than
// stark black, closer to the light theme than a jarring switch.)
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference)

  useEffect(() => {
    const mql = window.matchMedia(DARK_QUERY)
    const sync = () => setPreference(mql.matches ? 'dark' : 'light')
    sync()
    mql.addEventListener('change', sync)
    return () => mql.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    applyTheme(preference)
  }, [preference])

  return { preference }
}
