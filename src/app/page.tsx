'use client'

import { useState, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { SearchPanel } from '@/components/SearchPanel'
import { FilterChips } from '@/components/FilterChips'
import { RouteResults } from '@/components/RouteResults'
import { AlertBanner } from '@/components/AlertBanner'
import { MapView } from '@/components/MapView'
import { TransportMode } from '@/lib/types'
import { ALL_MODES } from '@/lib/constants'
import { useVehicles } from '@/hooks/use-vehicles'
import { useRoutePlan } from '@/hooks/use-route-plan'
import { useAlerts } from '@/hooks/use-alerts'

function HomeContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const modesFromUrl = searchParams.get('modes')
  const [activeModes, setActiveModes] = useState<TransportMode[]>(
    modesFromUrl ? (modesFromUrl.split(',') as TransportMode[]) : [...ALL_MODES],
  )
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)

  const vehicleData = useVehicles(activeModes)
  const { routes, loading, error, search } = useRoutePlan()
  const alertData = useAlerts()

  const handleToggle = useCallback(
    (mode: TransportMode) => {
      setActiveModes((prev) => {
        const next = prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
        if (next.length === 0) return prev
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
    search(fromPlace, toPlace, modes)
  }

  const selectedRoute = routes.find((r) => r.id === selectedRouteId)
  const selectedGeometry = selectedRoute?.legs
    .map((l) => l.legGeometry?.points)
    .filter(Boolean)
    .join('')

  return (
    <main className="h-dvh flex flex-col">
      {alertData.data?.alerts && alertData.data.alerts.length > 0 && (
        <AlertBanner alerts={alertData.data.alerts} />
      )}
      <SearchPanel onSearch={handleSearch} modes={activeModes} />
      <FilterChips activeModes={activeModes} onToggle={handleToggle} />
      <RouteResults
        routes={routes}
        loading={loading}
        error={error}
        selectedId={selectedRouteId}
        onSelect={setSelectedRouteId}
      />
      <MapView
        vehicles={vehicleData.data?.vehicles}
        activeModes={activeModes}
        routeGeometry={selectedGeometry}
      />
    </main>
  )
}

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  )
}
