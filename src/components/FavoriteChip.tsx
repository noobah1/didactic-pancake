'use client'

import { Star, X } from 'lucide-react'
import { FavoriteRoute } from '@/lib/types'

interface FavoriteChipProps {
  favorite: FavoriteRoute
  onSelect: () => void
  onRemove: () => void
}

export function FavoriteChip({ favorite, onSelect, onRemove }: FavoriteChipProps) {
  return (
    <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-2xl shadow-md pl-3 pr-1 py-1.5">
      <button
        type="button"
        onClick={onSelect}
        className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-200 hover:text-blue-700 dark:hover:text-blue-400"
      >
        <Star size={12} fill="#F59E0B" stroke="#F59E0B" />
        <span className="max-w-[10rem] truncate">{favorite.fromName}</span>
        <span className="text-gray-400">&rarr;</span>
        <span className="max-w-[10rem] truncate">{favorite.toName}</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove favorite ${favorite.fromName} to ${favorite.toName}`}
        className="p-0.5 rounded-full text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
      >
        <X size={12} />
      </button>
    </div>
  )
}
