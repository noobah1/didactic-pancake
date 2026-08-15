'use client'

import { AlertTriangle } from 'lucide-react'

interface IssuesButtonProps {
  active: boolean
  count: number
  onClick: () => void
}

export function IssuesButton({ active, count, onClick }: IssuesButtonProps) {
  const hasIssues = count > 0

  return (
    <button
      onClick={onClick}
      className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all border-2 ${
        active
          ? 'bg-amber-100 dark:bg-amber-900 border-amber-500'
          : hasIssues
            ? 'bg-white dark:bg-gray-800 border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950'
            : 'bg-white dark:bg-gray-800 border-transparent hover:bg-gray-50 dark:hover:bg-gray-700'
      }`}
      title={active ? 'Hide issues' : `Show issues (${count})`}
    >
      <AlertTriangle
        size={24}
        fill={hasIssues ? '#FBBF24' : 'none'}
        stroke={active ? '#B45309' : hasIssues ? '#D97706' : '#6B7280'}
        strokeWidth={2}
      />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  )
}
