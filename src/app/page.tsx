'use client'

import { useState, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { SearchPanel } from '@/components/SearchPanel'
import { FilterChips } from '@/components/FilterChips'
import { RouteResults } from '@/components/RouteResults'
import { AlertBanner } from '@/components/AlertBanner'
import { MapView } from '@/components/MapView'
import { IncidentButton } from '@/components/IncidentButton'
import { ErrorBoundary } from '@/components/ErrorBoundary'
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
  const [showIncidents, setShowIncidents] = useState(false)

  const testAlerts = searchParams.get('test_alerts') === '1'

  const vehicleData = useVehicles(activeModes)
  const { routes, loading, error, search, clear } = useRoutePlan()
  const alertData = useAlerts(testAlerts)

  const handleToggle = useCallback(
    (mode: TransportMode) => {
      const next = activeModes.includes(mode)
        ? activeModes.filter((m) => m !== mode)
        : [...activeModes, mode]
      if (next.length === 0) return
      setActiveModes(next)
      const params = new URLSearchParams(searchParams.toString())
      if (next.length === ALL_MODES.length) {
        params.delete('modes')
      } else {
        params.set('modes', next.join(','))
      }
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [activeModes, searchParams, router],
  )

  const handleSearch = (fromPlace: string, toPlace: string, modes: TransportMode[], dateTime?: string) => {
    search(fromPlace, toPlace, modes, dateTime)
  }

  const handleClear = () => {
    clear()
    setSelectedRouteId(null)
  }

  const activeAlerts = useMemo(
    () =>
      (alertData.data?.alerts || []).filter(
        (a) => a.severity !== 'info' && a.affectedRoutes.length > 0,
      ),
    [alertData.data?.alerts],
  )

  const selectedRoute = routes.find((r) => r.id === selectedRouteId) || null

  return (
    <main className="h-dvh relative overflow-hidden">
      {/* Fullscreen map base layer */}
      <ErrorBoundary
        fallback={
          <div className="absolute inset-0 flex items-center justify-center text-gray-500">
            Map unavailable
          </div>
        }
      >
        <MapView
          vehicles={vehicleData.data?.vehicles}
          activeModes={activeModes}
          selectedRoute={selectedRoute}
          incidents={showIncidents ? activeAlerts : undefined}
        />
      </ErrorBoundary>

      {/* Alert banner - top of viewport */}
      {alertData.data?.alerts && alertData.data.alerts.length > 0 && (
        <div className="absolute top-0 left-0 right-0 z-40">
          <AlertBanner alerts={alertData.data.alerts} />
        </div>
      )}

      {/* Floating UI column - top center */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-full max-w-lg px-3 sm:px-0 pointer-events-none">
        <div className="pointer-events-auto">
          <SearchPanel onSearch={handleSearch} onClear={handleClear} modes={activeModes} />
        </div>
        <div className="pointer-events-auto">
          <ErrorBoundary
            fallback={<div className="p-4 text-center text-gray-500">Route search unavailable</div>}
          >
            <RouteResults
              routes={routes}
              loading={loading}
              error={error}
              selectedId={selectedRouteId}
              onSelect={setSelectedRouteId}
            />
          </ErrorBoundary>
        </div>
        <div className="pointer-events-auto mt-2 flex justify-start">
          <FilterChips activeModes={activeModes} onToggle={handleToggle} />
        </div>
      </div>

      {/* Incident button - bottom right */}
      <div className="absolute bottom-6 right-4 z-30 pointer-events-auto">
        <IncidentButton
          active={showIncidents}
          alertCount={activeAlerts.length}
          onClick={() => setShowIncidents((prev) => !prev)}
        />
      </div>
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
