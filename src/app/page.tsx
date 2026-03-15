'use client'
import { useJourneyMonitor } from '@/hooks/use-journey-monitor'
import { DelayBanner } from '@/components/DelayBanner'
import { useState, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Image from 'next/image'
const logo3 = '/logo3.png'
import { SearchPanel } from '@/components/SearchPanel'
import { FilterChips } from '@/components/FilterChips'
import { RouteResults } from '@/components/RouteResults'
import { AlertBanner } from '@/components/AlertBanner'
import { MapView } from '@/components/MapView'
import { IncidentButton } from '@/components/IncidentButton'
import { ErrorBoundary } from '@/components/ErrorBoundary'
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
  const { routes, loading, error, search, clear } = useRoutePlan()
  const alertData = useAlerts(testAlerts)

  const handleCityToggle = (city: CityDef) => {
    const isActive = activeCities.some((c) => c.id === city.id)
    const next = isActive
      ? activeCities.filter((c) => c.id !== city.id)
      : [...activeCities, city]
    setActiveCities(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next.length === 0 || next.length === CITIES.length) {
      params.delete('cities')
    } else {
      params.set('cities', next.map((c) => c.id).join(','))
    }
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  const handleCountyToggle = (countyCities: CityDef[]) => {
    const allActive = countyCities.every((c) => activeCities.some((ac) => ac.id === c.id))
    const countyIds = new Set(countyCities.map((c) => c.id))
    const next = allActive
      ? activeCities.filter((c) => !countyIds.has(c.id))
      : [...activeCities, ...countyCities.filter((c) => !activeCities.some((ac) => ac.id === c.id))]
    setActiveCities(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next.length === 0 || next.length === CITIES.length) {
      params.delete('cities')
    } else {
      params.set('cities', next.map((c) => c.id).join(','))
    }
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  const handleSetAllCities = (cities: CityDef[]) => {
    setActiveCities(cities)
    const params = new URLSearchParams(searchParams.toString())
    if (cities.length === 0 || cities.length === CITIES.length) {
      params.delete('cities')
    } else {
      params.set('cities', cities.map((c) => c.id).join(','))
    }
    router.replace(`?${params.toString()}`, { scroll: false })
  }

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

  const handleSearch = (fromPlace: string, toPlace: string, modes: TransportMode[], dateTime?: string, arriveBy?: boolean) => {
    search(fromPlace, toPlace, modes, dateTime, arriveBy)
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

const { warnings, dismissWarning } = useJourneyMonitor(selectedRoute)
 
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
          selectedVehicle={selectedVehicle}
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
          <SearchPanel onSearch={handleSearch} onClear={handleClear} modes={activeModes} activeCities={activeCities} onCityToggle={handleCityToggle} onCountyToggle={handleCountyToggle} onSetAllCities={handleSetAllCities} />
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
            <DelayBanner
  warnings={warnings}
  onGetAlternatives={() => {
    if (selectedRoute) {
      const firstLeg = selectedRoute.legs[0]
      search(
        `${firstLeg.from.lat},${firstLeg.from.lng}`,
        `${selectedRoute.legs[selectedRoute.legs.length - 1].to.lat},${selectedRoute.legs[selectedRoute.legs.length - 1].to.lng}`,
        activeModes,
      )
    }
  }}
  onDismiss={dismissWarning}
/>
          </ErrorBoundary>
        </div>
        <div className="pointer-events-auto mt-2 flex flex-wrap justify-start gap-2">
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

      {/* Logo - bottom center */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none opacity-60">
        <Image src={logo3} alt="Logo" height={24} className="w-auto" />
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
