// The OTP graph is built from three GTFS feeds (otp/build-config.json), and
// two of them repeat services the unified feed ("1:") already carries:
//  - "2:" is otp/data/elron.zip, committed once and never refreshed, so its
//    train timetable is months out of date (it still holds trips the
//    current schedule dropped) -- see ELRON_AGENCY_GTFS_ID in constants.ts.
//  - "3:" is tslaevad.zip (ferries), which is current but identical to the
//    ferry routes inside the unified feed.
// Without filtering, a train or ferry shows up twice on a board, and the
// stale copy can show a departure that no longer runs.

const STALE_FEED_PREFIX = '2:'

export function isStaleFeedTrip(tripGtfsId: string | undefined | null): boolean {
  return !!tripGtfsId && tripGtfsId.startsWith(STALE_FEED_PREFIX)
}

// Keeps the first item per key; callers list preferred ("1:") items first.
export function dedupeFirst<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = keyOf(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Lower is better: the unified feed first, then anything else.
function feedRank(tripGtfsId: string): number {
  return tripGtfsId.startsWith('1:') ? 0 : 1
}

export interface DepartureLike {
  tripId: string
  line: string
  mode: string
  headsign: string
  departureEpochSec: number
}

// Drops the stale feed's trips and collapses the same ride listed by two feeds
// (same mode, line, headsign and departure time).
export function dedupeDepartures<T extends DepartureLike>(deps: T[]): T[] {
  const fresh = deps.filter((d) => !isStaleFeedTrip(d.tripId))
  const ranked = [...fresh].sort((a, b) => feedRank(a.tripId) - feedRank(b.tripId))
  const kept = new Set(dedupeFirst(ranked, (d) => `${d.mode}|${d.line}|${d.headsign}|${d.departureEpochSec}`))
  return fresh.filter((d) => kept.has(d))
}

export interface ItineraryLike {
  startTime: string | number
  endTime: string | number
  legs: { mode: string; route?: { shortName?: string | null } | null; trip?: { gtfsId?: string } | null; from?: { name?: string }; to?: { name?: string } }[]
}

// Same idea for planned journeys: an itinerary riding a stale-feed trip is
// dropped (when anything else remains), and two itineraries that ride the
// same services at the same times collapse into one.
export function dedupeItineraries<T extends ItineraryLike>(itineraries: T[]): T[] {
  const fresh = itineraries.filter((it) => !it.legs.some((l) => isStaleFeedTrip(l.trip?.gtfsId)))
  const pool = fresh.length > 0 ? fresh : itineraries
  return dedupeFirst(pool, (it) =>
    [
      it.startTime,
      it.endTime,
      ...it.legs.map((l) => `${l.mode}:${l.route?.shortName ?? ''}:${l.from?.name ?? ''}>${l.to?.name ?? ''}`),
    ].join('|'),
  )
}
