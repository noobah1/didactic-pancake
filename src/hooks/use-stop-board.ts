import { useCallback, useMemo } from 'react'
import { usePolling } from './use-polling'
import { StopBoardData } from '@/lib/types'
import { POLL_INTERVALS } from '@/lib/constants'
import { readCachedEntry, writeCachedEntry } from '@/lib/offline-cache'

const CACHE_KEY = 'stopBoardCache'

export function useStopBoard(stopId: string | null) {
  const fetcher = useCallback(async (): Promise<StopBoardData> => {
    const res = await fetch(`/api/stop-board?stopId=${encodeURIComponent(stopId!)}`)
    if (!res.ok) throw new Error('Failed to fetch stop board')
    const data: StopBoardData = await res.json()
    if (stopId) writeCachedEntry(CACHE_KEY, stopId, data)
    return data
  }, [stopId])

  const { data, error, lastUpdated } = usePolling(fetcher, POLL_INTERVALS.stopBoard, stopId != null)

  // Cold start with no network at all: usePolling's own `data` never got a
  // first success, so without this it would sit on `null` forever. Read
  // whatever was last cached for this exact stop -- offline is the whole
  // reason this cache exists (see public/sw.js's comment on why /api/ is
  // never cached there).
  const cached = useMemo(() => (stopId ? readCachedEntry<StopBoardData>(CACHE_KEY, stopId) : null), [stopId])

  if (data) {
    // Already-loaded data lingers in usePolling's state across a failed
    // poll (see that hook), so a mid-session network drop still has
    // something to show here -- just mark it stale using the last time a
    // poll actually succeeded, rather than pretending it's still live.
    return { data, error, lastUpdated, stale: !!error, staleSince: error ? lastUpdated : null }
  }
  if (cached) {
    return { data: cached.data, error, lastUpdated: null, stale: true, staleSince: cached.cachedAt }
  }
  return { data: null, error, lastUpdated, stale: false, staleSince: null }
}
