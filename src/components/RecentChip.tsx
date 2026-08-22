'use client'

import { Clock, X } from 'lucide-react'
import { RecentSearch } from '@/lib/types'
import { useTranslation } from '@/lib/i18n/context'

interface RecentChipProps {
  recent: RecentSearch
  onSelect: () => void
  onRemove: () => void
}

export function RecentChip({ recent, onSelect, onRemove }: RecentChipProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm pl-3 pr-1 py-1.5">
      <button
        type="button"
        onClick={onSelect}
        className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-700 dark:hover:text-blue-400"
      >
        <Clock size={12} />
        <span className="max-w-[10rem] truncate">{recent.fromName}</span>
        <span className="text-gray-400">&rarr;</span>
        <span className="max-w-[10rem] truncate">{recent.toName}</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('search.removeRecentAria', { from: recent.fromName, to: recent.toName })}
        className="p-0.5 rounded-full text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
      >
        <X size={12} />
      </button>
    </div>
  )
}
