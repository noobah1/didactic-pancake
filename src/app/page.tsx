'use client'

import { Suspense, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { SearchPanel } from '@/components/SearchPanel'
import { FilterChips } from '@/components/FilterChips'
import { MapView } from '@/components/MapView'
import { TransportMode } from '@/lib/types'
import { ALL_MODES } from '@/lib/constants'

function HomeContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const modesFromUrl = searchParams.get('modes')
  const [activeModes, setActiveModes] = useState<TransportMode[]>(
    modesFromUrl ? (modesFromUrl.split(',') as TransportMode[]) : [...ALL_MODES],
  )

  const handleToggle = useCallback(
    (mode: TransportMode) => {
      setActiveModes((prev) => {
        const next = prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
        if (next.length === 0) return prev // Don't allow empty
        const params = new URLSearchParams(searchParams.toString())
        if (next.length === ALL_MODES.length) {
          params.delete('modes')
        } else {
          params.set('modes', next.join(','))
        }
        router.replace(`?${params.toString()}`, { scroll: false })
        return next
      })
    },
    [searchParams, router],
  )

  const handleSearch = (fromPlace: string, toPlace: string, modes: TransportMode[]) => {
    // Will be connected in Task 13
    console.log('Search:', { fromPlace, toPlace, modes })
  }

  return (
    <main className="h-dvh flex flex-col">
      <SearchPanel onSearch={handleSearch} modes={activeModes} />
      <FilterChips activeModes={activeModes} onToggle={handleToggle} />
      <MapView />
    </main>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<div className="h-dvh flex items-center justify-center">Loading...</div>}>
      <HomeContent />
    </Suspense>
  )
}
