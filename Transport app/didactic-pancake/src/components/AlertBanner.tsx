'use client'

import { useState } from 'react'
import { ServiceAlert } from '@/lib/types'

interface AlertBannerProps {
  alerts: ServiceAlert[]
}

export function AlertBanner({ alerts }: AlertBannerProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visible = alerts.filter((a) => !dismissed.has(a.id))
  if (visible.length === 0) return null

  const alert = visible[0]
  const bgColor = alert.severity === 'severe' ? 'bg-red-500' : 'bg-amber-500'

  return (
    <div className={`${bgColor} text-white px-4 py-2 flex items-center justify-between text-sm rounded-b-lg shadow-md`}>
      <div>
        <strong>{alert.headerText}</strong>
        {alert.descriptionText && <span className="ml-2 opacity-90">{alert.descriptionText}</span>}
      </div>
      <button
        onClick={() => setDismissed((prev) => new Set(prev).add(alert.id))}
        className="ml-4 text-white opacity-80 hover:opacity-100"
      >
        x
      </button>
    </div>
  )
}
