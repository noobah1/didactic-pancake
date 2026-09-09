// GTFS convention: trips running in the small hours (before roughly 4am) are
// still filed under the PREVIOUS calendar day's service date, with times
// past midnight encoded as 24:xx rather than rolling over — a bus departing
// at 00:21 shows up as scheduledDeparture 86460 under YESTERDAY's service
// date, not as 1260 under today's. Naively using today's wall-clock date
// during this window makes every currently-running late trip invisible to
// any tripsForDate(serviceDate: ...) query.
const SERVICE_DAY_ROLLOVER_HOUR = 4

function tallinnParts(): { hour: number; min: number; sec: number } {
  const [h, m, s] = new Date()
    .toLocaleTimeString('en-GB', { timeZone: 'Europe/Tallinn', hour12: false })
    .split(':')
    .map((p) => parseInt(p, 10))
  return { hour: h, min: m, sec: s }
}

// The GTFS service date to query tripsForDate against right now.
export function getServiceDate(): string {
  const { hour } = tallinnParts()
  const base = hour < SERVICE_DAY_ROLLOVER_HOUR ? new Date(Date.now() - 24 * 60 * 60 * 1000) : new Date()
  return base.toLocaleDateString('en-CA', { timeZone: 'Europe/Tallinn' })
}

// Seconds since the SERVICE date's midnight (not wall-clock midnight) — before
// the rollover hour this is >= 86400, matching the 24:xx encoding used by
// trips carried over from the previous calendar day, so it can be compared
// directly against scheduledDeparture/scheduledArrival.
export function getServiceSeconds(): number {
  const { hour, min, sec } = tallinnParts()
  const seconds = hour * 3600 + min * 60 + sec
  return hour < SERVICE_DAY_ROLLOVER_HOUR ? seconds + 86400 : seconds
}
