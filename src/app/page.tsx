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
import { CitySelector } from '@/components/CitySelector'
import { TimetablePanel } from '@/components/TimetablePanel'
import { TransportMode, VehiclePosition } from '@/lib/types'
import { ALL_MODES, CITIES, CityDef } from '@/lib/constants'
import { useVehicles } from '@/hooks/use-vehicles'
import { useRoutePlan } from '@/hooks/use-route-plan'
import { useAlerts } from '@/hooks/use-alerts'

function HomeContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const modesFromUrl = searchParams.get('modes')
  const citiesFromUrl = searchParams.get('cities')
  const [activeCities, setActiveCities] = useState<CityDef[]>(() => {
    if (citiesFromUrl) {
      const ids = citiesFromUrl.split(',')
      const matched = CITIES.filter((c) => ids.includes(c.id))
      return matched.length > 0 ? matched : [CITIES[0]]
    }
    return [CITIES[0]]
  })
  const [activeModes, setActiveModes] = useState<TransportMode[]>(
    modesFromUrl ? (modesFromUrl.split(',') as TransportMode[]) : [...ALL_MODES],
  )
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [selectedVehicle, setSelectedVehicle] = useState<VehiclePosition | null>(null)
  const [showIncidents, setShowIncidents] = useState(false)

  const testAlerts = searchParams.get('test_alerts') === '1'

  const vehicleData = useVehicles(activeModes, activeCities)
  const { routes, loading, error, search } = useRoutePlan()
  const alertData = useAlerts(testAlerts)

  const handleCityToggle = useCallback(
    (city: CityDef) => {
      const isActive = activeCities.some((c) => c.id === city.id)
      const next = isActive
        ? activeCities.filter((c) => c.id !== city.id)
        : [...activeCities, city]
      if (next.length === 0) return
      setActiveCities(next)
      const params = new URLSearchParams(searchParams.toString())
      if (next.length === CITIES.length) {
        params.delete('cities')
      } else {
        params.set('cities', next.map((c) => c.id).join(','))
      }
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [activeCities, searchParams, router],
  )

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
          cities={activeCities}
          onVehicleClick={setSelectedVehicle}
        />
      </ErrorBoundary>

      {/* Timetable panel - bottom left */}
      {selectedVehicle && (
        <TimetablePanel
          vehicle={selectedVehicle}
          vehicles={vehicleData.data?.vehicles}
          onClose={() => setSelectedVehicle(null)}
        />
      )}

      {/* Alert banner - top of viewport */}
      {alertData.data?.alerts && alertData.data.alerts.length > 0 && (
        <div className="absolute top-0 left-0 right-0 z-40">
          <AlertBanner alerts={alertData.data.alerts} />
        </div>
      )}

      {/* Floating UI column - top center */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-full max-w-lg px-3 sm:px-0 pointer-events-none">
        <div className="pointer-events-auto">
          <SearchPanel onSearch={handleSearch} modes={activeModes} />
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
        <div className="pointer-events-auto mt-2 flex justify-start gap-2">
          <CitySelector activeCities={activeCities} onToggle={handleCityToggle} />
          <FilterChips activeModes={activeModes} onToggle={handleToggle} />
          <IncidentButton
            active={showIncidents}
            alertCount={activeAlerts.length}
            onClick={() => setShowIncidents((prev) => !prev)}
          />
        </div>
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
