import { useCallback, useState } from 'react'

// Shared drag-to-resize state for a bottom-sheet-style panel (see
// SheetHandle) — extracted from RouteResults so StopBoard and
// TimetablePanel can offer the same rider-resizable panel for long
// departure/stop lists instead of a fixed max-height.
export function useResizableSheet(defaultVh: number, minVh: number, maxVh: number) {
  const [heightVh, setHeightVh] = useState<number | null>(null)

  const resize = useCallback((deltaVh: number) => {
    setHeightVh((prev) => {
      const base = prev ?? defaultVh
      return Math.min(maxVh, Math.max(minVh, base + deltaVh))
    })
  }, [defaultVh, minVh, maxVh])

  const reset = useCallback(() => setHeightVh(null), [])

  return { heightVh, resize, reset }
}
