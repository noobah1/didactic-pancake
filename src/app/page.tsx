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
import { IssuesButton } from '@/components/IssuesButton'
import { IssuesPanel } from '@/components/IssuesPanel'
import { DelayToast } from '@/components/DelayToast'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { TimetablePanel } from '@/components/TimetablePanel'
import { ThemeToggle } from '@/components/ThemeToggle'
import { TransportMode, VehiclePosition } from '@/lib/types'
import { ALL_MODES, CITIES, CityDef, TALLINN_CENTER } from '@/lib/constants'
import { OVERVIEW_THRESHOLD_SEC, findVehicleForLeg, distanceMeters } from '@/lib/delay'
import { DelayedVehicle } from '@/app/api/delays/route'
import { useVehicles } from '@/hooks/use-vehicles'
import { useRoutePlan } from '@/hooks/use-route-plan'
import { useAlerts } from '@/hooks/use-alerts'
import { useDelays } from '@/hooks/use-delays'
import { useDelayToast } from '@/hooks/use-delay-toast'
import { useTheme } from '@/hooks/use-theme'

function HomeContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { preference: themePreference, setPreference: setThemePreference } = useTheme()

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
  const [selectedVehicleDelayed, setSelectedVehicleDelayed] = useState(false)
  // The trip the delay board itself already matched this vehicle to, if
  // selection came from there — passed to TimetablePanel so its very first
  // fetch is hinted instead of running an entirely independent, unhinted
  // match that can (and often does) land on a different trip than the
  // board just showed for the same vehicle. Cleared on a plain map click,
  // which has no such trip to hand over.
  const [selectedVehicleInitialTripId, setSelectedVehicleInitialTripId] = useState<string | null>(null)
  const [showIssues, setShowIssues] = useState(false)

  const testAlerts = searchParams.get('test_alerts') === '1'

  const vehicleData = useVehicles(activeModes, activeCities)
  const { routes, loading, error, search, clear } = useRoutePlan()
  const alertData = useAlerts(testAlerts)
  const delayData = useDelays()

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

  const handleSelectDelayedVehicle = (vehicle: DelayedVehicle) => {
    // The delay board's own position can be up to ~25s stale (20s poll +
    // 5s server cache), while the map marker for the same vehicle id comes
    // from the separate /api/vehicles feed that refreshes every ~12s — so
    // flying the camera to the delay board's snapshot instead of the
    // marker's actual live position lands next to the (correctly ringed)
    // marker, not on it. Prefer the fresher position when we have it.
    const live = vehicleData.data?.vehicles.find((v) => v.id === vehicle.vehicleId)
    setSelectedVehicle({
      id: vehicle.vehicleId,
      mode: vehicle.mode,
      line: vehicle.line,
      lat: live?.lat ?? vehicle.lat,
      lng: live?.lng ?? vehicle.lng,
      heading: live?.heading ?? vehicle.heading,
      destination: vehicle.destination,
    })
    setSelectedVehicleInitialTripId(vehicle.tripId)
    setSelectedVehicleDelayed(true)
    setShowIssues(false)
  }

  const handleVehicleClick = (vehicle: VehiclePosition | null) => {
    setSelectedVehicle(vehicle)
    setSelectedVehicleInitialTripId(null)
    setSelectedVehicleDelayed(false)
  }

  const activeAlerts = useMemo(() => {
    const filtered = (alertData.data?.alerts || []).filter(
      (a) => a.severity !== 'info' && a.affectedRoutes.length > 0,
    )
    // Located disruptions (Tark Tee) can run into the dozens nationwide —
    // sort them nearest-first to whatever the user's currently looking at
    // (their active city filter, Tallinn by default) so the list stays
    // useful instead of a flat wall of far-away roadworks. Alerts with no
    // location (OTP-sourced) have nothing to sort by, so they stay put at
    // the front — they're few and already operator-curated.
    const reference = activeCities[0] || { lat: TALLINN_CENTER.lat, lng: TALLINN_CENTER.lng }
    const located = filtered.filter((a) => a.lat != null && a.lng != null)
    const unlocated = filtered.filter((a) => a.lat == null || a.lng == null)
    located.sort(
      (a, b) =>
        distanceMeters(a.lat!, a.lng!, reference.lat, reference.lng) -
        distanceMeters(b.lat!, b.lng!, reference.lat, reference.lng),
    )
    return [...unlocated, ...located]
  }, [alertData.data?.alerts, activeCities])

  const selectedRoute = routes.find((r) => r.id === selectedRouteId) || null

  // For the journey you've picked, find the actual live vehicle running each
  // transit leg (by tripId) — GPS-tracked modes come from the delay feed,
  // rail/ferry (no live GPS) fall back to the schedule-interpolated position
  // already in the main vehicles feed — so you can see where your bus/tram/
  // train currently is, not just the planned line on the map. When the exact
  // tripId doesn't turn up a match, findVehicleForLeg (shared with RouteCard's
  // delay badge) falls back to a position+heading match instead.
  const nowMs = new Date().getTime()
  const journeyVehicles = useMemo(() => {
    if (!selectedRoute) return []
    const found: VehiclePosition[] = []
    for (const leg of selectedRoute.legs) {
      if (leg.mode === 'walk') continue

      if (leg.tripId) {
        const gpsMatch = delayData.data?.vehicles.find((v) => v.tripId === leg.tripId)
        if (gpsMatch) {
          found.push({
            id: gpsMatch.vehicleId,
            mode: gpsMatch.mode,
            line: gpsMatch.line,
            lat: gpsMatch.lat,
            lng: gpsMatch.lng,
            heading: gpsMatch.heading,
            destination: gpsMatch.destination,
          })
          continue
        }
        const scheduledMatch = vehicleData.data?.vehicles.find((v) => v.id === leg.tripId)
        if (scheduledMatch) {
          found.push(scheduledMatch)
          continue
        }
      }

      const best = findVehicleForLeg(leg, vehicleData.data?.vehicles || [], nowMs)
      if (best) found.push(best)
    }
    return found
  }, [selectedRoute, delayData.data?.vehicles, vehicleData.data?.vehicles, nowMs])

  const delayedVehicleCount = (delayData.data?.vehicles || []).filter(
    (v) => v.delaySeconds >= OVERVIEW_THRESHOLD_SEC,
  ).length

  // Toast pop-ups should only surface delays on the trip you've actually
  // selected — not every newly-delayed vehicle citywide (that's what the
  // Issues panel / OVERVIEW_THRESHOLD_SEC count are for). Without this, a
  // toast fired for any late bus anywhere in the city regardless of
  // relevance to the current user.
  const journeyTripIds = useMemo(
    () => new Set((selectedRoute?.legs || []).map((leg) => leg.tripId).filter((id): id is string => !!id)),
    [selectedRoute],
  )
  const journeyDelayVehicles = useMemo(
    () => (delayData.data?.vehicles || []).filter((v) => journeyTripIds.has(v.tripId)),
    [delayData.data?.vehicles, journeyTripIds],
  )
  // Keyed on the selected route so switching to a different (possibly
  // already-delayed) route doesn't itself read as "newly delayed" — only
  // a delay that develops while you're actually looking at this route does.
  const { toast, dismiss: dismissToast } = useDelayToast(journeyDelayVehicles, selectedRoute?.id ?? null)

const { warnings, dismissWarning } = useJourneyMonitor(selectedRoute, delayData.data?.vehicles)

  return (
    <main className="h-dvh relative overflow-hidden">
      {/* Fullscreen map base layer */}
      <ErrorBoundary
        fallback={
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 dark:text-gray-400">
            Map unavailable
          </div>
        }
      >
        <MapView
          vehicles={vehicleData.data?.vehicles}
          activeModes={activeModes}
          selectedRoute={selectedRoute}
          journeyVehicles={journeyVehicles}
          selectedVehicle={selectedVehicle}
          highlightDelay={selectedVehicleDelayed}
          incidents={showIssues ? activeAlerts : undefined}
          cities={activeCities}
          onVehicleClick={handleVehicleClick}
        />
      </ErrorBoundary>

      {/* Timetable panel - bottom left */}
      {selectedVehicle && (
        <TimetablePanel
          vehicle={selectedVehicle}
          vehicles={vehicleData.data?.vehicles}
          initialTripId={selectedVehicleInitialTripId}
          onClose={() => { setSelectedVehicle(null); setSelectedVehicleInitialTripId(null) }}
          onLateChange={setSelectedVehicleDelayed}
        />
      )}

      {/* Alert banner - top of viewport */}
      {alertData.data?.alerts && alertData.data.alerts.length > 0 && (
        <div className="absolute top-0 left-0 right-0 z-40">
          <AlertBanner alerts={alertData.data.alerts} />
        </div>
      )}

      {/* Floating UI column - top center. On mobile it spans full width, leaving just
          a gutter on the right to clear the map's zoom/locate controls, instead of
          shrinking the whole box down; from sm: up it's centered and capped as before. */}
      <div
        id="floating-ui-column"
        className="absolute top-3 left-3 right-11 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-30 sm:w-[88%] sm:max-w-lg pointer-events-none"
      >
        <div className="pointer-events-auto">
          <SearchPanel onSearch={handleSearch} onClear={handleClear} modes={activeModes} activeCities={activeCities} onCityToggle={handleCityToggle} onCountyToggle={handleCountyToggle} onSetAllCities={handleSetAllCities} />
        </div>
        <div className="pointer-events-auto mt-8 sm:mt-0">
          <ErrorBoundary
            fallback={<div className="p-4 text-center text-gray-500 dark:text-gray-400">Route search unavailable</div>}
          >
            <RouteResults
              routes={routes}
              loading={loading}
              error={error}
              selectedId={selectedRouteId}
              onSelect={setSelectedRouteId}
              delayVehicles={delayData.data?.vehicles}
            />
            <DelayBanner
  warnings={warnings}
  onGetAlternatives={() => {
    if (selectedRoute) {
      const firstLeg = selectedRoute.legs[0]
      // Re-running the identical search almost always comes back with the
      // same top itinerary — ban the specific delayed trip(s) so OTP is
      // forced to route around them instead of just re-confirming the same
      // pick.
      const bannedTrips = warnings
        .map((w) => selectedRoute.legs[w.legIndex]?.tripId)
        .filter((id): id is string => !!id)
      search(
        `${firstLeg.from.lat},${firstLeg.from.lng}`,
        `${selectedRoute.legs[selectedRoute.legs.length - 1].to.lat},${selectedRoute.legs[selectedRoute.legs.length - 1].to.lng}`,
        activeModes,
        undefined,
        undefined,
        bannedTrips,
      )
    }
  }}
  onDismiss={dismissWarning}
/>
          </ErrorBoundary>
        </div>
        {!selectedRouteId && (
          <div className="pointer-events-auto mt-2 flex flex-wrap justify-start gap-2">
            <FilterChips activeModes={activeModes} onToggle={handleToggle} />
          </div>
        )}
      </div>

      {/* Delay toast - briefly announces newly-detected delays */}
      {toast && !showIssues && (
        <DelayToast
          text={toast.text}
          onDismiss={dismissToast}
          onClick={() => {
            setShowIssues(true)
            dismissToast()
          }}
        />
      )}

      {/* Issues panel - above the issues button */}
      {showIssues && (
        <IssuesPanel
          vehicles={delayData.data?.vehicles || []}
          alerts={activeAlerts}
          onSelectVehicle={handleSelectDelayedVehicle}
          onClose={() => setShowIssues(false)}
        />
      )}

      {/* Theme toggle - bottom right, left of the issues button */}
      <div className="absolute bottom-6 right-20 z-30 pointer-events-auto">
        <ThemeToggle preference={themePreference} onChange={setThemePreference} />
      </div>

      {/* Issues button - bottom right (delays + service alerts, merged) */}
      <div className="absolute bottom-6 right-4 z-30 pointer-events-auto">
        <IssuesButton
          active={showIssues}
          count={delayedVehicleCount + activeAlerts.length}
          onClick={() => setShowIssues((prev) => !prev)}
        />
      </div>

      {/* Logo - bottom center */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none opacity-60">
        <Image src={logo3} alt="Logo" width={80} height={24} className="w-auto" />
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
