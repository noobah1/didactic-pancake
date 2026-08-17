import { useCallback } from 'react'
import { usePolling } from './use-polling'
import { StopBoardData } from '@/lib/types'
import { POLL_INTERVALS } from '@/lib/constants'

export function useStopBoard(stopId: string | null) {
  const fetcher = useCallback(async (): Promise<StopBoardData> => {
    const res = await fetch(`/api/stop-board?stopId=${encodeURIComponent(stopId!)}`)
    if (!res.ok) throw new Error('Failed to fetch stop board')
    return res.json()
  }, [stopId])

  return usePolling(fetcher, POLL_INTERVALS.stopBoard, stopId != null)
}
