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

  const poll = useCallback(async () => {
    try {
      const result = await fetcher()
      setData(result)
      setError(null)
      setLastUpdated(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Polling failed'))
    }
  }, [fetcher])

  useEffect(() => {
    if (!enabled) {
      clearInterval(timerRef.current)
      return
    }

    const initialId = setTimeout(poll, 0)
    timerRef.current = setInterval(poll, interval)
    return () => {
      clearTimeout(initialId)
      clearInterval(timerRef.current)
    }
  }, [poll, interval, enabled])

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
