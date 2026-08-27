import { Locale } from './types'

// Only used where month/weekday names should actually localize (e.g. "22
// Aug" vs "22 aug" vs "22 авг"). Plain HH:MM time formatting elsewhere keeps
// using 'en-GB' with hour12:false regardless of locale — that's just a
// reliable way to get 24-hour digits, not language-bearing text.
export function localeTag(locale: Locale): string {
  return locale === 'et' ? 'et-EE' : locale === 'ru' ? 'ru-RU' : 'en-GB'
}

// Localized counterpart of lib/format-minutes.ts's formatMinutes — same
// "45 min" below an hour, "1h"/"1h 5min" at or above rule, translated via
// the route.duration* keys instead of hardcoded English.
export function formatMinutesLocalized(totalMinutes: number, t: (path: string, vars?: Record<string, string | number>) => string): string {
  if (totalMinutes < 60) return t('route.durationMin', { n: totalMinutes })
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? t('route.durationHours', { h: hours }) : t('route.durationHoursMin', { h: hours, m: minutes })
}

// Fare amounts are stored as integer cents throughout src/lib/fares (never
// floats — see its own comments), so formatting is the one place that
// divides by 100, right before the value becomes display text.
export function formatEuroLocalized(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale), { style: 'currency', currency: 'EUR' }).format(cents / 100)
}
