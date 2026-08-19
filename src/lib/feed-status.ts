// What the server says about the payload it just returned.
export type Availability = 'live' | 'partial' | 'stale' | 'unavailable'

// What the client should render — folds in transport-level failure (fetch
// rejected, non-OK response) and the not-yet-fetched case, neither of which
// the server's own `availability` field can speak to.
export type FeedStatus = 'loading' | 'live' | 'partial' | 'stale' | 'unavailable'

// How long a warm cache may be served under an `availability: 'stale'` label
// before it's better described as `unavailable` — past this point the data
// is old enough that presenting it as merely "a bit behind" would itself be
// misleading (see the delays route's 45-hour outage: a snapshot this old,
// had the cache been warm, would otherwise have been served forever).
export const STALE_MAX_AGE_MS = 5 * 60_000

export function resolveFeedStatus(
  data: { availability?: Availability } | null,
  error: Error | null,
): FeedStatus {
  if (!data && !error) return 'loading'
  if (error) return data ? 'stale' : 'unavailable'
  return data?.availability ?? 'live'
}
