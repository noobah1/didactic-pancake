import { evaluateOpeningHours } from '../opening-hours'

// All fixed times are constructed as UTC instants that correspond to a known
// Europe/Tallinn wall-clock time. Tallinn is UTC+2 (EET) in winter and
// UTC+3 (EEST) in summer — the dates below are chosen in winter (no DST) so
// the UTC offset used to build each Date is simple and unambiguous.
// 2026-01-05 is a Monday.
function tallinnTime(isoDateUtcMinus2: string): Date {
  return new Date(isoDateUtcMinus2)
}

describe('evaluateOpeningHours', () => {
  it('is always open for 24/7', () => {
    const state = evaluateOpeningHours('24/7', tallinnTime('2026-01-05T10:00:00+02:00'))
    expect(state.state).toBe('open')
  })

  it('reports open with a closing time inside a simple weekday range', () => {
    // Monday 2026-01-05, 10:00 local, spec open 09:00-18:00
    const state = evaluateOpeningHours('Mo-Fr 09:00-18:00', tallinnTime('2026-01-05T10:00:00+02:00'))
    expect(state).toEqual({ state: 'open', closesAt: '18:00', closesInMinutes: 8 * 60 })
  })

  it('reports closed before opening, with the opening time', () => {
    const state = evaluateOpeningHours('Mo-Fr 09:00-18:00', tallinnTime('2026-01-05T07:00:00+02:00'))
    expect(state).toEqual({ state: 'closed', opensAt: '09:00', opensInMinutes: 2 * 60 })
  })

  it('reports closed after closing with no later opening today', () => {
    const state = evaluateOpeningHours('Mo-Fr 09:00-18:00', tallinnTime('2026-01-05T19:00:00+02:00'))
    expect(state).toEqual({ state: 'closed' })
  })

  it('reports closed on a day the spec never mentions', () => {
    // 2026-01-04 is a Sunday
    const state = evaluateOpeningHours('Mo-Fr 09:00-18:00', tallinnTime('2026-01-04T12:00:00+02:00'))
    expect(state).toEqual({ state: 'closed' })
  })

  it('handles a bare time-only spec (no day selector) as every day', () => {
    const state = evaluateOpeningHours('09:00-18:00', tallinnTime('2026-01-04T10:00:00+02:00'))
    expect(state.state).toBe('open')
  })

  it('supports multiple ranges per day (lunch break)', () => {
    const spec = 'Mo-Fr 08:00-12:00,13:00-17:00'
    const lunch = evaluateOpeningHours(spec, tallinnTime('2026-01-05T12:30:00+02:00'))
    expect(lunch).toEqual({ state: 'closed', opensAt: '13:00', opensInMinutes: 30 })
    const afternoon = evaluateOpeningHours(spec, tallinnTime('2026-01-05T14:00:00+02:00'))
    expect(afternoon).toEqual({ state: 'open', closesAt: '17:00', closesInMinutes: 3 * 60 })
  })

  it('supports ;-separated rules with different hours per day group', () => {
    const spec = 'Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off'
    // Saturday 2026-01-03
    const saturday = evaluateOpeningHours(spec, tallinnTime('2026-01-03T11:00:00+02:00'))
    expect(saturday).toEqual({ state: 'open', closesAt: '14:00', closesInMinutes: 3 * 60 })
    // Sunday 2026-01-04
    const sunday = evaluateOpeningHours(spec, tallinnTime('2026-01-04T11:00:00+02:00'))
    expect(sunday).toEqual({ state: 'closed' })
  })

  it('lets a later rule override an earlier one for the same day', () => {
    const spec = 'Mo-Su 09:00-18:00; We off'
    const wednesday = evaluateOpeningHours(spec, tallinnTime('2026-01-07T12:00:00+02:00'))
    expect(wednesday).toEqual({ state: 'closed' })
  })

  it('handles a past-midnight range correctly on both sides of midnight', () => {
    const spec = 'Fr-Sa 20:00-02:00'
    // Friday 2026-01-02, 23:00 — inside the Friday-initiated range
    const fridayNight = evaluateOpeningHours(spec, tallinnTime('2026-01-02T23:00:00+02:00'))
    expect(fridayNight).toEqual({ state: 'open', closesAt: '02:00', closesInMinutes: 3 * 60 })
    // Saturday 2026-01-03, 01:00 — spillover from Friday's range
    const saturdayEarly = evaluateOpeningHours(spec, tallinnTime('2026-01-03T01:00:00+02:00'))
    expect(saturdayEarly).toEqual({ state: 'open', closesAt: '02:00', closesInMinutes: 60 })
    // Saturday 2026-01-03, 03:00 — after Friday's spillover, before Saturday's own opening
    const saturdayGap = evaluateOpeningHours(spec, tallinnTime('2026-01-03T03:00:00+02:00'))
    expect(saturdayGap).toEqual({ state: 'closed', opensAt: '20:00', opensInMinutes: 17 * 60 })
  })

  it('returns unknown for a spec referencing public holidays', () => {
    expect(evaluateOpeningHours('Mo-Fr 09:00-18:00; PH off', tallinnTime('2026-01-05T10:00:00+02:00'))).toEqual({ state: 'unknown' })
  })

  it('returns unknown for a spec with a month range', () => {
    expect(evaluateOpeningHours('Apr-Oct Mo-Fr 09:00-18:00', tallinnTime('2026-01-05T10:00:00+02:00'))).toEqual({ state: 'unknown' })
  })

  it('returns unknown for a spec with a week selector', () => {
    expect(evaluateOpeningHours('week 1-20 Mo-Fr 09:00-18:00', tallinnTime('2026-01-05T10:00:00+02:00'))).toEqual({ state: 'unknown' })
  })

  it('returns unknown for sunrise/sunset hours', () => {
    expect(evaluateOpeningHours('Mo-Su sunrise-sunset', tallinnTime('2026-01-05T10:00:00+02:00'))).toEqual({ state: 'unknown' })
  })

  it('returns unknown for a spec with a quoted comment', () => {
    expect(evaluateOpeningHours('Mo-Fr 09:00-18:00 "by appointment"', tallinnTime('2026-01-05T10:00:00+02:00'))).toEqual({ state: 'unknown' })
  })

  it('returns unknown for the open-ended "open" keyword', () => {
    expect(evaluateOpeningHours('Mo-Fr open', tallinnTime('2026-01-05T10:00:00+02:00'))).toEqual({ state: 'unknown' })
  })

  it('returns unknown for garbage input', () => {
    expect(evaluateOpeningHours('not a real spec at all', tallinnTime('2026-01-05T10:00:00+02:00'))).toEqual({ state: 'unknown' })
  })

  it('returns unknown for an empty string', () => {
    expect(evaluateOpeningHours('', tallinnTime('2026-01-05T10:00:00+02:00'))).toEqual({ state: 'unknown' })
  })
})
