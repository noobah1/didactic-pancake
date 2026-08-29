'use client'

import { useMemo } from 'react'
import { X } from 'lucide-react'
import { VehiclePosition } from '@/lib/types'
import { MODE_COLORS, ALL_MODES } from '@/lib/constants'
import { useTranslation } from '@/lib/i18n/context'
import { LineFilter } from '@/lib/vehicle-filter'

interface FilterPanelProps {
  // Unfiltered — the panel needs to see every mode/line currently running,
  // not just what's already visible under an existing filter.
  vehicles: VehiclePosition[] | undefined
  value: LineFilter | null
  onChange: (next: LineFilter | null) => void
  onClose: () => void
}

// Numeric-then-alphabetical, matching how a rider expects line numbers to
// sort ("2" before "10") rather than a plain string sort ("10" before "2").
function compareLines(a: string, b: string): number {
  const numA = Number(a)
  const numB = Number(b)
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB
  return a.localeCompare(b)
}

export function FilterPanel({ vehicles, value, onChange, onClose }: FilterPanelProps) {
  const { t, modeLabel } = useTranslation()

  const linesByMode = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const v of vehicles || []) {
      if (!map.has(v.mode)) map.set(v.mode, new Set())
      map.get(v.mode)!.add(v.line)
    }
    return ALL_MODES.map((mode) => ({ mode, lines: Array.from(map.get(mode) || []).sort(compareLines) })).filter(
      (group) => group.lines.length > 0,
    )
  }, [vehicles])

  return (
    <div className="absolute bottom-24 right-4 z-40 w-80 max-h-[60vh] bg-white/85 dark:bg-gray-900/80 backdrop-blur-xl rounded-xl shadow-lg flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white shrink-0">
        <span className="text-sm font-semibold">{t('filter.title')}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('filter.close')}
          className="p-1 rounded-full hover:bg-white/20 shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex flex-col overflow-y-auto p-3 gap-3">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border self-start ${
            !value
              ? 'text-white bg-blue-600 border-blue-600'
              : 'text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
          }`}
        >
          {t('filter.showAll')}
        </button>

        {linesByMode.length === 0 && (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">{t('filter.noLines')}</div>
        )}

        {linesByMode.map(({ mode, lines }) => (
          <div key={mode} className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {modeLabel(mode)}
            </span>
            <div className="flex flex-wrap gap-1">
              {lines.map((line) => {
                const active = value?.mode === mode && value?.line === line
                return (
                  <button
                    key={line}
                    type="button"
                    onClick={() => onChange({ mode, line })}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap ${
                      active
                        ? 'text-white'
                        : 'text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                    style={active ? { backgroundColor: MODE_COLORS[mode], borderColor: MODE_COLORS[mode] } : undefined}
                  >
                    {line}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
