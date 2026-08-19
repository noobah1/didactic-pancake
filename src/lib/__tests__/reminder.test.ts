import { shouldSendReminder, tallinnNow, DEFAULT_LEAD_MINUTES, REMINDER_NOTIFY_WINDOW_MIN } from '../reminder'
import { FavoriteRoute } from '../types'

// 2026-08-17 is a Monday (weekday), 2026-08-15 a Saturday — both in EEST
// (Europe/Tallinn summer time, UTC+3), so "T04:50:00Z" reads as 07:50 local.
const MONDAY_0750Z = '2026-08-17T04:50:00Z' // 07:50 Mon
const SATURDAY_0750Z = '2026-08-15T04:50:00Z' // 07:50 Sat

function favorite(overrides: Partial<FavoriteRoute> = {}): FavoriteRoute {
  return {
    id: 'fav-1',
    fromName: 'Home',
    fromLat: 59.4,
    fromLng: 24.7,
    toName: 'Work',
    toLat: 59.43,
    toLng: 24.75,
    reminderEnabled: true,
    reminderTime: '08:00',
    reminderLeadMinutes: 10,
    ...overrides,
  }
}

describe('shouldSendReminder', () => {
  it('fires at the start of the notify window (leaveTime - leadMinutes)', () => {
    const now = tallinnNow(new Date(MONDAY_0750Z)) // 07:50, notify starts at 07:50 for 08:00/lead 10
    expect(shouldSendReminder(favorite(), now, undefined)).toBe(true)
  })

  it('does not fire one minute before the window opens', () => {
    const now = tallinnNow(new Date('2026-08-17T04:49:00Z')) // 07:49
    expect(shouldSendReminder(favorite(), now, undefined)).toBe(false)
  })

  it('does not fire once the window has closed', () => {
    const closeAt = new Date(MONDAY_0750Z)
    closeAt.setUTCMinutes(closeAt.getUTCMinutes() + REMINDER_NOTIFY_WINDOW_MIN)
    const now = tallinnNow(closeAt) // 07:53 — window is [07:50, 07:53)
    expect(shouldSendReminder(favorite(), now, undefined)).toBe(false)
  })

  it('fires on every minute inside the window, so a 60s check cadence cannot miss it', () => {
    for (let m = 0; m < REMINDER_NOTIFY_WINDOW_MIN; m++) {
      const at = new Date(MONDAY_0750Z)
      at.setUTCMinutes(at.getUTCMinutes() + m)
      const now = tallinnNow(at)
      expect(shouldSendReminder(favorite(), now, undefined)).toBe(true)
    }
  })

  it('does not re-fire once already sent today', () => {
    const now = tallinnNow(new Date(MONDAY_0750Z))
    expect(shouldSendReminder(favorite(), now, now.dateStr)).toBe(false)
  })

  it('fires again the next day even if sent yesterday', () => {
    const now = tallinnNow(new Date(MONDAY_0750Z))
    expect(shouldSendReminder(favorite(), now, '2026-08-16')).toBe(true)
  })

  it('does not fire on a weekend', () => {
    const now = tallinnNow(new Date(SATURDAY_0750Z))
    expect(shouldSendReminder(favorite(), now, undefined)).toBe(false)
  })

  it('does not fire when the reminder is disabled', () => {
    const now = tallinnNow(new Date(MONDAY_0750Z))
    expect(shouldSendReminder(favorite({ reminderEnabled: false }), now, undefined)).toBe(false)
  })

  it('does not fire when reminderTime is missing', () => {
    const now = tallinnNow(new Date(MONDAY_0750Z))
    expect(shouldSendReminder(favorite({ reminderTime: undefined }), now, undefined)).toBe(false)
  })

  it('does not fire when reminderTime is malformed', () => {
    const now = tallinnNow(new Date(MONDAY_0750Z))
    expect(shouldSendReminder(favorite({ reminderTime: 'not-a-time' }), now, undefined)).toBe(false)
  })

  it('defaults the lead time to DEFAULT_LEAD_MINUTES when unset', () => {
    expect(DEFAULT_LEAD_MINUTES).toBe(10) // MONDAY_0750Z below assumes this
    const now = tallinnNow(new Date(MONDAY_0750Z)) // 07:50, i.e. 08:00 - 10
    expect(
      shouldSendReminder(favorite({ reminderLeadMinutes: undefined, reminderTime: '08:00' }), now, undefined),
    ).toBe(true)
  })

  // Regression: a leave time/lead combo whose notify minute lands before
  // midnight used to never satisfy `now >= notify` under a raw ordinal
  // comparison — "00:05" with a 10-minute lead computes notify = -5, which
  // must wrap to 23:55 the previous evening rather than never firing.
  it('wraps a notify time that falls before midnight to the previous evening', () => {
    // 23:55 Mon local -> 20:55Z (Mon is in EEST, UTC+3)
    const now = tallinnNow(new Date('2026-08-17T20:55:00Z'))
    expect(now.hour).toBe(23)
    expect(now.minute).toBe(55)
    expect(shouldSendReminder(favorite({ reminderTime: '00:05', reminderLeadMinutes: 10 }), now, undefined)).toBe(
      true,
    )
  })

  it('does not fire for that same wrapped reminder well before 23:55', () => {
    const now = tallinnNow(new Date('2026-08-17T15:00:00Z')) // 18:00 local
    expect(shouldSendReminder(favorite({ reminderTime: '00:05', reminderLeadMinutes: 10 }), now, undefined)).toBe(
      false,
    )
  })
})

describe('tallinnNow', () => {
  it('rolls the date and weekday over at local midnight', () => {
    const now = tallinnNow(new Date('2026-08-19T21:10:00Z')) // 00:10 Thu local
    expect(now.hour).toBe(0)
    expect(now.minute).toBe(10)
    expect(now.dateStr).toBe('2026-08-20')
    expect(now.isWeekday).toBe(true)
  })

  it('stays correct across the spring-forward DST transition', () => {
    // 2026-03-29 01:00Z is when Europe/Tallinn jumps from EET to EEST.
    const before = tallinnNow(new Date('2026-03-28T23:30:00Z'))
    const after = tallinnNow(new Date('2026-03-29T01:30:00Z'))
    expect(before.hour).toBe(1)
    expect(before.minute).toBe(30)
    expect(after.hour).toBe(4)
    expect(after.minute).toBe(30)
  })

  it('stays correct across the fall-back DST transition', () => {
    // 2026-10-25 01:00Z is when Europe/Tallinn falls back from EEST to EET.
    const before = tallinnNow(new Date('2026-10-24T22:30:00Z'))
    const after = tallinnNow(new Date('2026-10-25T01:30:00Z'))
    expect(before.hour).toBe(1)
    expect(after.hour).toBe(3)
  })
})
