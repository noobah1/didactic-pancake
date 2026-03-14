import { useEffect, useRef, useCallback, useState } from 'react'

export function usePolling<T>(
  fetcher: () => Promise<T>,
  interval: number,
  enabled: boolean = true,
) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined)

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const poll = useCallback(async () => {
    try {
      const result = await fetcherRef.current()
      setData(result)
      setError(null)
      setLastUpdated(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Polling failed'))
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      clearInterval(timerRef.current)
      return
    }

    poll()
    timerRef.current = setInterval(poll, interval)
    return () => {
      clearInterval(timerRef.current)
    }
  }, [poll, interval, enabled])

  // Re-fetch immediately when fetcher changes (e.g. modes/cities change)
  useEffect(() => {
    if (enabled) poll()
  }, [fetcher, enabled, poll])

  // Pause polling when tab is hidden
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(timerRef.current)
      } else if (enabled) {
        poll()
        timerRef.current = setInterval(poll, interval)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [poll, interval, enabled])

  return { data, error, lastUpdated }
}
