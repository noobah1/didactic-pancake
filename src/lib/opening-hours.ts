// A deliberately partial parser for OSM's opening_hours syntax
// (wiki.openstreetmap.org/wiki/Key:opening_hours). Real-world values run
// from trivial ("Mo-Fr 09:00-18:00") to genuinely ambiguous (public-holiday
// rules, "sunrise-sunset", month ranges, free-text comments in quotes) —
// this covers the common cases exactly and refuses to guess on the rest.
//
// Same house rule as TripStopInfo.delaySeconds/StopDeparture.delaySeconds
// (see types.ts: "absent means no live evidence, never zero") applied here:
// an open/closed badge that's occasionally wrong is worse than no badge at
// all, so anything this parser doesn't fully understand returns 'unknown'
// rather than a best-effort guess.

export type OpenState =
  | { state: 'open'; closesAt?: string; closesInMinutes?: number }
  | { state: 'closed'; opensAt?: string; opensInMinutes?: number }
  | { state: 'unknown' }

const DAY_CODES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const
type DayCode = (typeof DAY_CODES)[number]

interface TimeRange {
  startMin: number // minutes since local midnight, always in [0, 1440)
  endMin: number // may exceed 1440 for a range that rolls past midnight
}

// One rule ("<days> <times>" or "<days> off") from a ';'-separated spec.
// ranges: [] means explicitly closed on `days`.
interface DayRule {
  days: Set<DayCode>
  ranges: TimeRange[]
}

// Parsed once per distinct spec string rather than once per evaluation call
// — evaluateOpeningHours runs per dropdown row per keystroke, so re-parsing
// the same static spec on every call would be wasted work at the one place
// (LocationInput's result list) this actually gets called in a loop.
const parseCache = new Map<string, DayRule[] | null>()

function parseTimeToMinutes(raw: string): number | null {
  const m = /^([0-2]?\d):([0-5]\d)$/.exec(raw)
  if (!m) return null
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (hours > 48) return null
  return hours * 60 + minutes
}

function expandDayRange(from: DayCode, to: DayCode): DayCode[] {
  const fromIdx = DAY_CODES.indexOf(from)
  const toIdx = DAY_CODES.indexOf(to)
  const days: DayCode[] = []
  let i = fromIdx
  for (let count = 0; count < 7; count++) {
    days.push(DAY_CODES[i])
    if (i === toIdx) break
    i = (i + 1) % 7
  }
  return days
}

function parseDaySelector(selector: string): DayCode[] | null {
  const parts = selector.split(',').map((p) => p.trim())
  const days = new Set<DayCode>()
  for (const part of parts) {
    const rangeMatch = /^(Su|Mo|Tu|We|Th|Fr|Sa)-(Su|Mo|Tu|We|Th|Fr|Sa)$/.exec(part)
    if (rangeMatch) {
      for (const d of expandDayRange(rangeMatch[1] as DayCode, rangeMatch[2] as DayCode)) days.add(d)
      continue
    }
    if ((DAY_CODES as readonly string[]).includes(part)) {
      days.add(part as DayCode)
      continue
    }
    return null // unrecognized day token — bail rather than guess
  }
  return Array.from(days)
}

function parseTimeSelector(selector: string): TimeRange[] | null {
  const parts = selector.split(',').map((p) => p.trim())
  const ranges: TimeRange[] = []
  for (const part of parts) {
    const m = /^([0-2]?\d:[0-5]\d)-([0-2]?\d:[0-5]\d)$/.exec(part)
    if (!m) return null
    const start = parseTimeToMinutes(m[1])
    let end = parseTimeToMinutes(m[2])
    if (start === null || end === null) return null
    // A close time <= its own open time means it actually rolls past
    // midnight (e.g. "20:00-02:00") — represent that as minutes beyond 1440
    // rather than a separate wraparound flag, so every later range check in
    // this file stays a single comparison.
    if (end <= start) end += 24 * 60
    ranges.push({ startMin: start, endMin: end })
  }
  return ranges
}

// Anything this function doesn't recognize as one of the supported forms
// causes the whole spec to be rejected (parseOpeningHours returns null) —
// a single unparseable rule inside an otherwise-simple spec makes the
// entire spec's state unknowable, since a later rule can override an
// earlier one and silently skipping the one we can't read risks hiding an
// "off" override we failed to apply.
function parseRule(rule: string): DayRule | 'always-open' | null {
  const trimmed = rule.trim()
  if (!trimmed) return null
  if (trimmed === '24/7') return 'always-open'

  // Explicit bail-outs for syntax this parser deliberately does not
  // support: holiday rules, month/week selectors, sunrise/sunset, quoted
  // comments, and the open-ended 'open'/'unknown' keywords. Matching them
  // by name (rather than just falling through to "no day token matched")
  // makes the refusal a documented decision, not an accidental gap.
  if (/\bPH\b|\bSH\b/.test(trimmed)) return null
  if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(trimmed)) return null
  if (/\bweek\b/i.test(trimmed)) return null
  if (/sunrise|sunset|dawn|dusk/i.test(trimmed)) return null
  if (/"/.test(trimmed)) return null
  if (/\b(open|unknown)\b/i.test(trimmed)) return null

  const offMatch = /^(.+?)\s+off$/.exec(trimmed)
  if (offMatch) {
    const days = parseDaySelector(offMatch[1].trim())
    if (!days) return null
    return { days: new Set(days), ranges: [] }
  }

  // "<days> <times>", or — when no day selector is present — a bare
  // "09:00-18:00" spec, valid OSM syntax meaning every day of the week.
  const parts = trimmed.split(/\s+/)
  const firstToken = parts[0]
  const looksLikeDaySelector =
    /^(Su|Mo|Tu|We|Th|Fr|Sa)(-(Su|Mo|Tu|We|Th|Fr|Sa))?(,(Su|Mo|Tu|We|Th|Fr|Sa)(-(Su|Mo|Tu|We|Th|Fr|Sa))?)*$/.test(firstToken)

  const daySelector = looksLikeDaySelector ? firstToken : null
  const timeSelector = looksLikeDaySelector ? parts.slice(1).join(' ') : trimmed

  const days = daySelector ? parseDaySelector(daySelector) : DAY_CODES.slice()
  if (!days || days.length === 0) return null
  const ranges = parseTimeSelector(timeSelector)
  if (!ranges) return null

  return { days: new Set(days), ranges }
}

function parseOpeningHours(spec: string): DayRule[] | null {
  const cached = parseCache.get(spec)
  if (cached !== undefined) return cached

  const result = (() => {
    const rules = spec.split(';').map((r) => r.trim()).filter(Boolean)
    if (rules.length === 0) return null
    const dayRules: DayRule[] = []
    for (const rule of rules) {
      const parsed = parseRule(rule)
      if (parsed === null) return null // any unparseable rule voids the whole spec
      if (parsed === 'always-open') {
        for (const day of DAY_CODES) dayRules.push({ days: new Set([day]), ranges: [{ startMin: 0, endMin: 24 * 60 }] })
        continue
      }
      dayRules.push(parsed)
    }
    return dayRules
  })()

  parseCache.set(spec, result)
  return result
}

// Reduces a spec's ordered rule list to one effective range list per day —
// a later ';'-separated rule fully overrides an earlier one for any day it
// also covers (OSM's own override semantics), so "Mo-Fr 09:00-18:00; We off"
// correctly leaves Wednesday closed rather than merging the two. A day no
// rule ever mentions ends up with no entry at all, which evaluate treats
// the same as an explicit "off" — both are closed, and the distinction
// isn't meaningful to a rider either way.
function effectiveRangesByDay(dayRules: DayRule[]): Map<DayCode, TimeRange[]> {
  const byDay = new Map<DayCode, TimeRange[]>()
  for (const rule of dayRules) {
    for (const day of rule.days) byDay.set(day, rule.ranges)
  }
  return byDay
}

function dayCodeAt(date: Date, tz: string): DayCode {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date)
  const map: Record<string, DayCode> = { Sun: 'Su', Mon: 'Mo', Tue: 'Tu', Wed: 'We', Thu: 'Th', Fri: 'Fr', Sat: 'Sa' }
  return map[weekday]
}

function minutesSinceMidnight(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

function formatClock(minutesTotal: number): string {
  const normalized = ((minutesTotal % (24 * 60)) + 24 * 60) % (24 * 60)
  const h = Math.floor(normalized / 60)
  const m = normalized % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Evaluated against `tz` explicitly (default Europe/Tallinn, the only
// timezone real venues in this app's data actually sit in) via
// Intl.DateTimeFormat rather than the host's own local time, so this
// behaves identically whether it runs inside the server's UTC container or
// a rider's browser anywhere in the world.
export function evaluateOpeningHours(spec: string, at: Date, tz = 'Europe/Tallinn'): OpenState {
  const dayRules = parseOpeningHours(spec)
  if (!dayRules) return { state: 'unknown' }

  const byDay = effectiveRangesByDay(dayRules)
  const today = dayCodeAt(at, tz)
  const yesterday = DAY_CODES[(DAY_CODES.indexOf(today) + 6) % 7]
  const nowMin = minutesSinceMidnight(at, tz)

  const todayRanges = byDay.get(today) ?? []
  const yesterdayRanges = byDay.get(yesterday) ?? []

  // Currently inside a range that started today.
  for (const range of todayRanges) {
    if (nowMin >= range.startMin && nowMin < range.endMin) {
      return { state: 'open', closesAt: formatClock(range.endMin), closesInMinutes: range.endMin - nowMin }
    }
  }
  // Currently inside yesterday's range spilling past midnight into today's
  // small hours (e.g. yesterday "Fr 20:00-26:00" covers today 00:00-02:00).
  for (const range of yesterdayRanges) {
    if (range.endMin > 24 * 60) {
      const spilloverEnd = range.endMin - 24 * 60
      if (nowMin < spilloverEnd) {
        return { state: 'open', closesAt: formatClock(spilloverEnd), closesInMinutes: spilloverEnd - nowMin }
      }
    }
  }

  // Closed — if today has a later opening time, surface it; a spec this
  // parser accepted at all means every day is deterministically known, so
  // there's no 'unknown' branch left to fall into here.
  let nextOpenToday: number | null = null
  for (const range of todayRanges) {
    if (range.startMin > nowMin && (nextOpenToday === null || range.startMin < nextOpenToday)) {
      nextOpenToday = range.startMin
    }
  }
  if (nextOpenToday !== null) {
    return { state: 'closed', opensAt: formatClock(nextOpenToday), opensInMinutes: nextOpenToday - nowMin }
  }
  return { state: 'closed' }
}
