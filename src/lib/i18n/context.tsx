'use client'

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react'
import { Locale, LOCALES } from './types'
import en from './en'
import et from './et'
import ru from './ru'
import { TransportMode } from '@/lib/types'

const DICTIONARIES = { en, et, ru }
export const LANG_STORAGE_KEY = 'lt-lang'

function isLocale(value: string | null): value is Locale {
  return !!value && (LOCALES as string[]).includes(value)
}

// Mirrors use-theme.ts's initialPreference pattern: layout.tsx's inline
// script (see langInitScript) already set document.documentElement.lang to
// the right value before first paint, so reading it back here on the
// client's first render is correct immediately rather than defaulting to
// 'et' and correcting a tick later. suppressHydrationWarning on <html>
// covers the resulting (expected) mismatch with the server-rendered markup.
function initialLocale(): Locale {
  if (typeof document === 'undefined') return 'et'
  const lang = document.documentElement.lang
  return isLocale(lang) ? lang : 'et'
}

function getByPath(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object' && key in node) {
      return (node as Record<string, unknown>)[key]
    }
    return undefined
  }, dict)
}

type Vars = Record<string, string | number>

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match))
}

interface LanguageContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (path: string, vars?: Vars) => string
  modeLabel: (mode: TransportMode) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next)
    } catch {
      // Private browsing / storage disabled — the choice just won't persist
      // across visits, which is harmless.
    }
  }, [])

  const t = useCallback(
    (path: string, vars?: Vars) => {
      const value = getByPath(DICTIONARIES[locale], path) ?? getByPath(DICTIONARIES.en, path)
      return typeof value === 'string' ? interpolate(value, vars) : path
    },
    [locale],
  )

  const modeLabel = useCallback((mode: TransportMode) => t(`modes.${mode}`), [t])

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t, modeLabel }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useTranslation() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useTranslation must be used within a LanguageProvider')
  return ctx
}
