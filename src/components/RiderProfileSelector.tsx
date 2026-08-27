'use client'

import { useEffect, useRef, useState } from 'react'
import { Ticket } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/context'
import { useRiderProfile } from '@/hooks/use-rider-profile'
import { RiderCategory } from '@/lib/fares/tariffs'
import { CITIES } from '@/lib/constants'

const AGE_BANDS: RiderCategory[] = ['child', 'youth', 'adult', 'senior']

// Self-contained like LanguageSelector — reads/writes the rider's fare
// profile straight from localStorage via useRiderProfile, with no props from
// SearchPanel/page.tsx. Fare pricing (src/lib/fares/price.ts) reads the same
// hook directly wherever a RouteCard renders, so this never needs plumbing
// through the search/plan call chain the way wheelchair mode does.
export function RiderProfileSelector() {
  const { t } = useTranslation()
  const { profile, setAgeBand, setResidentOf } = useRiderProfile()
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

  const customized = profile.ageBand !== 'adult' || !!profile.residentOf

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={t('fare.profileTitle')}
        title={t('fare.profileTitle')}
        className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center shadow-md border ${customized ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
      >
        <Ticket size={20} />
      </button>
      {expanded && (
        <div className="absolute top-12 right-0 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 p-3 w-56">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('fare.profileTitle')}</div>
          <div className="grid grid-cols-2 gap-1 mb-3">
            {AGE_BANDS.map((band) => (
              <button
                key={band}
                type="button"
                onClick={() => setAgeBand(band)}
                className={`px-2 py-1.5 rounded-lg text-xs ${
                  band === profile.ageBand
                    ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/50 font-medium'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {t(`fare.profile${band[0].toUpperCase()}${band.slice(1)}`)}
              </button>
            ))}
          </div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('fare.residentOf')}</label>
          <select
            value={profile.residentOf || ''}
            onChange={(e) => setResidentOf(e.target.value || undefined)}
            className="w-full px-2 py-1.5 rounded-lg text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
          >
            <option value="">—</option>
            {CITIES.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
