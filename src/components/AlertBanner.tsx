'use client'

import { useEffect, useState } from 'react'
import { ServiceAlert } from '@/lib/types'

interface AlertBannerProps {
  alerts: ServiceAlert[]
}

export function AlertBanner({ alerts }: AlertBannerProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  // Which alert is currently shown — a plain array index would jump to a
  // different alert whenever the underlying alerts list is merely reordered
  // by a background poll (Tark Tee's own feature ordering isn't guaranteed
  // stable between fetches), so track the alert's own id instead and fall
  // back to the first one whenever that id is no longer present.
  const [currentId, setCurrentId] = useState<string | null>(null)

  const visible = alerts.filter((a) => !dismissed.has(a.id))

  useEffect(() => {
    if (visible.length === 0) {
      setCurrentId(null)
      return
    }
    if (!visible.some((a) => a.id === currentId)) {
      setCurrentId(visible[0].id)
    }
    // Only re-run when the set of visible alerts actually changes, not on
    // every currentId update from the prev/next buttons below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.map((a) => a.id).join(',')])

  if (visible.length === 0) return null

  const index = Math.max(0, visible.findIndex((a) => a.id === currentId))
  const alert = visible[index]
  const bgColor = alert.severity === 'severe' ? 'bg-red-500' : 'bg-amber-500'

  const step = (delta: number) => {
    const next = (index + delta + visible.length) % visible.length
    setCurrentId(visible[next].id)
  }

  return (
    <div className={`${bgColor} text-white px-4 py-2 flex items-center justify-between gap-3 text-sm rounded-b-lg shadow-md`}>
      {visible.length > 1 && (
        <button
          onClick={() => step(-1)}
          aria-label="Previous disruption"
          className="shrink-0 text-white opacity-80 hover:opacity-100 text-base leading-none"
        >
          ‹
        </button>
      )}
      <div className="flex-1 min-w-0">
        {visible.length > 1 && (
          <span className="opacity-75 mr-2 text-xs align-middle">{index + 1}/{visible.length}</span>
        )}
        <strong>{alert.headerText}</strong>
        {alert.descriptionText && <span className="ml-2 opacity-90">{alert.descriptionText}</span>}
      </div>
      {visible.length > 1 && (
        <button
          onClick={() => step(1)}
          aria-label="Next disruption"
          className="shrink-0 text-white opacity-80 hover:opacity-100 text-base leading-none"
        >
          ›
        </button>
      )}
      <button
        onClick={() => setDismissed((prev) => new Set(prev).add(alert.id))}
        aria-label="Dismiss"
        className="shrink-0 ml-1 text-white opacity-80 hover:opacity-100"
      >
        x
      </button>
    </div>
  )
}
