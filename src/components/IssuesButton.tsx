'use client'

import { AlertTriangle } from 'lucide-react'

interface IssuesButtonProps {
  active: boolean
  count: number
  // True when the live delay/alert feed couldn't be fetched at all — a
  // fourth state the button never had before: count === 0 used to assert
  // "all clear" as fact even when the feed behind it was actually down.
  degraded?: boolean
  onClick: () => void
}

export function IssuesButton({ active, count, degraded, onClick }: IssuesButtonProps) {
  const hasIssues = count > 0

  return (
    <button
      onClick={onClick}
      className={`relative w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all border-2 ${
        active
          ? 'bg-amber-100 dark:bg-amber-900 border-amber-500'
          : degraded
            ? 'bg-white dark:bg-gray-800 border-red-400 hover:bg-red-50 dark:hover:bg-red-950'
            : hasIssues
              ? 'bg-white dark:bg-gray-800 border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950'
              : 'bg-white dark:bg-gray-800 border-transparent hover:bg-gray-50 dark:hover:bg-gray-700'
      }`}
      title={degraded ? 'Live issue data unavailable' : active ? 'Hide issues' : `Show issues (${count})`}
    >
      <AlertTriangle
        size={24}
        fill={hasIssues ? '#FBBF24' : 'none'}
        stroke={active ? '#B45309' : degraded ? '#DC2626' : hasIssues ? '#D97706' : '#6B7280'}
        strokeWidth={2}
      />
      {degraded ? (
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-white dark:border-gray-800" />
      ) : (
        count > 0 && (
          <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )
      )}
    </button>
  )
}
