import { FavoriteRoute } from '@/lib/types'

// Shared with FavoriteChip.tsx's editor default so the UI and the checker
// agree on what an unset lead time means.
export const DEFAULT_LEAD_MINUTES = 10

// A "leave now" reminder must fire inside [leaveTime - leadMinutes, that +
// this window) — wide enough to survive the 60s check cadence without being
// missed, narrow enough that a checker outage earlier in the day doesn't
// cause a wildly late "leave now" hours after the fact.
export const REMINDER_NOTIFY_WINDOW_MIN = 3

export interface TallinnNow {
  hour: number
  minute: number
  dateStr: string // "YYYY-MM-DD"
  isWeekday: boolean
}

export function tallinnNow(at: Date = new Date()): TallinnNow {
  const [h, m] = at.toLocaleTimeString('en-GB', { timeZone: 'Europe/Tallinn', hour12: false }).split(':')
  const weekday = at.toLocaleDateString('en-US', { timeZone: 'Europe/Tallinn', weekday: 'short' })
  return {
    hour: parseInt(h, 10),
    minute: parseInt(m, 10),
    dateStr: at.toLocaleDateString('en-CA', { timeZone: 'Europe/Tallinn' }),
    isWeekday: weekday !== 'Sat' && weekday !== 'Sun',
  }
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

// True when `favorite`'s reminder should fire right now. Weekdays only (no
// per-day picker yet). The notify minute is wrapped into a 0-1439 range and
// compared by elapsed-minutes-since-notify (also wrapped) rather than by
// raw ordinal comparison, so a leave time/lead combo that lands before
// midnight (e.g. "00:05" with a 10-minute lead -> notify at 23:55) still
// fires instead of never satisfying `now >= notify`.
export function shouldSendReminder(favorite: FavoriteRoute, now: TallinnNow, lastSentDate: string | undefined): boolean {
  if (!favorite.reminderEnabled || !favorite.reminderTime || !now.isWeekday) return false

  const [leaveHour, leaveMinute] = favorite.reminderTime.split(':').map(Number)
  if (Number.isNaN(leaveHour) || Number.isNaN(leaveMinute)) return false

  const leadMinutes = favorite.reminderLeadMinutes ?? DEFAULT_LEAD_MINUTES
  const notifyMinuteOfDay = mod(leaveHour * 60 + leaveMinute - leadMinutes, 1440)
  const nowMinuteOfDay = now.hour * 60 + now.minute
  const elapsed = mod(nowMinuteOfDay - notifyMinuteOfDay, 1440)
  if (elapsed >= REMINDER_NOTIFY_WINDOW_MIN) return false

  if (lastSentDate === now.dateStr) return false

  return true
}
