import type { Locale } from '@/lib/i18n/types'

// A rider reading a live marker needs to know how stale it might be — the
// web has no reliable background location, so "3 min ago" vs "just now" is
// often the difference between trusting the dot and not. locale defaults to
// 'en' so existing callers/tests that don't pass one are unaffected.
export function formatAgo(ms: number, locale: Locale = 'en'): string {
  if (ms < 60_000) {
    return locale === 'et' ? 'just praegu' : locale === 'ru' ? 'только что' : 'just now'
  }
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) {
    if (locale === 'et') return `${minutes} min tagasi`
    if (locale === 'ru') return `${minutes} мин назад`
    return `${minutes} min ago`
  }
  const hours = Math.round(minutes / 60)
  if (locale === 'et') return `${hours}h tagasi`
  if (locale === 'ru') return `${hours} ч назад`
  return `${hours}h ago`
}
