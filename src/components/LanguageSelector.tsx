'use client'

import { useEffect, useRef, useState } from 'react'
import { Languages } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/context'
import { Locale, LOCALES } from '@/lib/i18n/types'

const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  et: 'Eesti',
  ru: 'Русский',
}

export function LanguageSelector() {
  const { locale, setLocale, t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!expanded) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setExpanded(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [expanded])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={t('language.label')}
        title={t('language.label')}
        className="flex items-center gap-1.5 h-10 px-3 bg-white dark:bg-gray-800 rounded-full shadow-md text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        <Languages size={14} />
        {locale.toUpperCase()}
      </button>
      {expanded && (
        <div className="absolute top-12 right-0 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 p-1 min-w-[8rem]">
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => {
                setLocale(l)
                setExpanded(false)
              }}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-sm ${
                l === locale
                  ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/50 font-medium'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {LOCALE_NAMES[l]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
