'use client'
import { useJourneyMonitor } from '@/hooks/use-journey-monitor'
import { DelayBanner } from '@/components/DelayBanner'
import { useState, useCallback, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { AnimatePresence } from 'motion/react'
import Image from 'next/image'
const logo3 = '/logo3.png'
import { SearchPanel } from '@/components/SearchPanel'
import { FilterChips } from '@/components/FilterChips'
import { RouteResults } from '@/components/RouteResults'
import { MapView } from '@/components/MapView'
import { IssuesButton } from '@/components/IssuesButton'
import { IssuesPanel } from '@/components/IssuesPanel'
import { NearbyButton } from '@/components/NearbyButton'
import { NearbyPanel } from '@/components/NearbyPanel'
import { DelayToast } from '@/components/DelayToast'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { TimetablePanel } from '@/components/TimetablePanel'
import { StopBoard, StopBoardTarget } from '@/components/StopBoard'
import { NotificationToggle } from '@/components/NotificationToggle'
import { TransportMode, VehiclePosition, ServiceAlert, StopDeparture } from '@/lib/types'
import { ALL_MODES, CITIES, CityDef, TALLINN_CENTER } from '@/lib/constants'
import { OVERVIEW_THRESHOLD_SEC, findVehicleForLeg, distanceMeters } from '@/lib/delay'
import { DelayedVehicle } from '@/app/api/delays/route'
import { useVehicles } from '@/hooks/use-vehicles'
import { useRoutePlan } from '@/hooks/use-route-plan'
import { useAlerts } from '@/hooks/use-alerts'
import { useDelays } from '@/hooks/use-delays'
import { useDelayToast } from '@/hooks/use-delay-toast'
import { useTheme } from '@/hooks/use-theme'
import { usePushNotifications } from '@/hooks/use-push-notifications'

function HomeContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  // No return value needed — mounting this is what keeps the app's theme
  // synced to the OS/browser preference (including a live change while the
  // tab stays open); see use-theme.ts.
  useTheme()
  const { enabled: notificationsEnabled, busy: notificationsBusy, enable: enableNotifications, disable: disableNotifications, supported: pushSupported } = usePushNotifications()

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
  const [showNearby, setShowNearby] = useState(false)
  const [focusedAlert, setFocusedAlert] = useState<ServiceAlert | null>(null)
  const [stopBoard, setStopBoard] = useState<StopBoardTarget | null>(null)

  const testAlerts = searchParams.get('test_alerts') === '1'

  const vehicleData = useVehicles(activeModes, activeCities)
  const { routes, loading, error, notice, search, clear, selectedRouteId, selectRoute, loadSharedRoute, setShareError } = useRoutePlan()
  const alertData = useAlerts(testAlerts)
  const delayData = useDelays()

  // A journey opened from a shared link (see RouteResults' Share button)
  // arrives as a fully-formed RouteResult, not a search to re-run — pull it
  // in once on load, then drop the param so it doesn't linger in the URL or
  // re-fetch on a later refresh (localStorage already has it from here on).
  const shareId = searchParams.get('share')
  useEffect(() => {
    if (!shareId) return
    let cancelled = false
    fetch(`/api/share?id=${encodeURIComponent(shareId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) loadSharedRoute(data.route)
      })
      .catch(() => {
        if (!cancelled) setShareError('This shared journey has expired or could not be found.')
      })
      .finally(() => {
        if (cancelled) return
        const params = new URLSearchParams(searchParams.toString())
        params.delete('share')
        router.replace(`?${params.toString()}`, { scroll: false })
      })
    return () => {
      cancelled = true
    }
    // Only ever run for the share id present on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId])

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
    setStopBoard(null)
    search(fromPlace, toPlace, modes, dateTime, arriveBy)
  }

  const handleClear = () => {
    clear()
  }

  const handleViewStopBoard = (name: string, lat: number, lng: number, stopId: string) => {
    clear()
    setStopBoard({ stopId, name, lat, lng })
  }

  const handleSelectDeparture = (departure: StopDeparture) => {
    if (!stopBoard) return
    // Same trick TimetablePanel/MapView already use for a scheduled (not yet
    // GPS-tracked) vehicle: an id containing ":" is treated as a direct
    // OTP tripId lookup rather than a live-GPS line/mode match, so this
    // opens the full route + stop list exactly like clicking one of those.
    setSelectedVehicle({
      id: departure.tripId,
      mode: departure.mode,
      line: departure.line,
      lat: stopBoard.lat,
      lng: stopBoard.lng,
      heading: 0,
      destination: departure.headsign,
      estimated: true,
    })
    setSelectedVehicleInitialTripId(null)
    setSelectedVehicleDelayed(false)
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

  // Line search (see SearchPanel's Departures-tab search, mixed in with
  // stops via /api/geocode) has no vehicle or trip to select up front — just
  // a mode + line code — so it has to find one itself rather than being
  // handed one like the handlers above. Checks the GPS-confirmed delay board
  // first (nationwide, not scoped to activeModes/activeCities, so a line
  // outside the map's current filters can still be found), then falls back
  // to the schedule-interpolated /api/vehicles feed (covers modes/lines
  // currently active but not GPS-tracked right now). Returns whether
  // anything was found, so SearchPanel knows whether to show its own "not
  // running" message — deliberately never fabricates a placeholder position
  // for a miss, which would risk showing a fake "confirmed" delay computed
  // against a point no real vehicle is at (see computeStatusFromGPS).
  const handleSelectLine = (mode: string, line: string): boolean => {
    const delayed = delayData.data?.vehicles.find((v) => v.mode === mode && v.line === line)
    if (delayed) {
      handleSelectDelayedVehicle(delayed)
      return true
    }
    const scheduled = vehicleData.data?.vehicles.find((v) => v.mode === mode && v.line === line)
    if (scheduled) {
      setSelectedVehicle(scheduled)
      setSelectedVehicleInitialTripId(null)
      setSelectedVehicleDelayed(false)
      return true
    }
    return false
  }

  const handleVehicleClick = (vehicle: VehiclePosition | null) => {
    setSelectedVehicle(vehicle)
    setSelectedVehicleInitialTripId(null)
    setSelectedVehicleDelayed(false)
  }

  // "All" (or none) selected means no city filter is actually active — show
  // everything nationwide, same as /api/vehicles treats an empty cities param.
  const showAllCities = activeCities.length === 0 || activeCities.length === CITIES.length
  // How far a disruption/delayed vehicle can be from a selected city and
  // still count as belonging to it — wide enough to cover a city's own
  // fanned-out regional routes, tight enough that another city never bleeds
  // in (any two of the top-15 cities are 30km+ apart, most far more).
  // Without this, selecting Tartu still showed Tallinn's own delays/
  // disruptions mixed in with Tartu's, right alongside every other city's —
  // impossible to actually read.
  const CITY_RELEVANCE_RADIUS_M = 30_000

  const activeAlerts = useMemo(() => {
    const filtered = (alertData.data?.alerts || []).filter(
      (a) => a.severity !== 'info' && a.affectedRoutes.length > 0,
    )
    const located = filtered.filter((a) => a.lat != null && a.lng != null)
    // Alerts with no location (OTP-sourced) have nothing to filter/sort by —
    // they're few and already operator-curated, so they stay in regardless.
    const unlocated = filtered.filter((a) => a.lat == null || a.lng == null)
    const relevant = showAllCities
      ? located
      : located.filter((a) =>
          activeCities.some((c) => distanceMeters(a.lat!, a.lng!, c.lat, c.lng) <= CITY_RELEVANCE_RADIUS_M),
        )
    const reference = activeCities[0] || { lat: TALLINN_CENTER.lat, lng: TALLINN_CENTER.lng }
    relevant.sort(
      (a, b) =>
        distanceMeters(a.lat!, a.lng!, reference.lat, reference.lng) -
        distanceMeters(b.lat!, b.lng!, reference.lat, reference.lng),
    )
    return [...unlocated, ...relevant]
  }, [alertData.data?.alerts, activeCities, showAllCities])

  const activeDelayedVehicles = useMemo(() => {
    const vehicles = delayData.data?.vehicles || []
    if (showAllCities) return vehicles
    return vehicles.filter((v) =>
      activeCities.some((c) => distanceMeters(v.lat, v.lng, c.lat, c.lng) <= CITY_RELEVANCE_RADIUS_M),
    )
  }, [delayData.data?.vehicles, activeCities, showAllCities])

  // Same city-relevance filtering as activeAlerts/activeDelayedVehicles
  // above, kept as a separate list rather than merged into either — these
  // are road-speed inferences for routes with no live GPS at all, not a
  // GPS-confirmed vehicle delay or an OTP/Tark Tee service alert (see
  // RouteTrafficEstimate in lib/types.ts).
  const activeTrafficEstimates = useMemo(() => {
    const estimates = delayData.data?.estimates || []
    if (showAllCities) return estimates
    return estimates.filter((e) =>
      activeCities.some((c) => distanceMeters(e.lat, e.lng, c.lat, c.lng) <= CITY_RELEVANCE_RADIUS_M),
    )
  }, [delayData.data?.estimates, activeCities, showAllCities])

  const selectedRoute = routes.find((r) => r.id === selectedRouteId) || null

  // For the journey you've picked, find the actual live vehicle running each
  // transit leg (by tripId) — GPS-tracked modes (including trains, via Elron's
  // feed) come from the delay feed, and anything not currently being reported
  // live falls back to the schedule-interpolated position already in the main
  // vehicles feed — so you can see where your bus/tram/
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

  const delayedVehicleCount = activeDelayedVehicles.filter(
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
          // Only the disruption the user actually picked from the issues
          // panel gets drawn — passing every active alert here drew every
          // piece of roadwork on the map the instant the panel opened.
          incidents={showIssues && focusedAlert ? [focusedAlert] : undefined}
          cities={activeCities}
          focusAlert={focusedAlert}
          focusStop={stopBoard}
          onVehicleClick={handleVehicleClick}
        />
      </ErrorBoundary>

      {/* Timetable panel - bottom left */}
      <AnimatePresence>
        {selectedVehicle && (
          <TimetablePanel
            key="timetable"
            vehicle={selectedVehicle}
            vehicles={vehicleData.data?.vehicles}
            initialTripId={selectedVehicleInitialTripId}
            onClose={() => { setSelectedVehicle(null); setSelectedVehicleInitialTripId(null) }}
            onLateChange={setSelectedVehicleDelayed}
          />
        )}
      </AnimatePresence>

      {/* Floating UI column - top center. On mobile it spans full width, leaving just
          a gutter on the right to clear the map's zoom/locate controls, instead of
          shrinking the whole box down; from sm: up it's centered and capped as before. */}
      <div
        id="floating-ui-column"
        className="absolute top-3 left-3 right-11 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-30 sm:w-[88%] sm:max-w-lg pointer-events-none"
      >
        <div className="pointer-events-auto">
          <SearchPanel onSearch={handleSearch} onClear={handleClear} modes={activeModes} activeCities={activeCities} onCityToggle={handleCityToggle} onCountyToggle={handleCountyToggle} onSetAllCities={handleSetAllCities} onViewStopBoard={handleViewStopBoard} onSelectLine={handleSelectLine} pushSupported={pushSupported} pushEnabled={notificationsEnabled} onEnablePush={enableNotifications} />
        </div>
        <div className="pointer-events-auto mt-8 sm:mt-0">
          <AnimatePresence>
            {stopBoard && (
              <ErrorBoundary
                key="stop-board"
                fallback={<div className="p-4 text-center text-gray-500 dark:text-gray-400">Departure board unavailable</div>}
              >
                <StopBoard stop={stopBoard} onClose={() => setStopBoard(null)} onSelectDeparture={handleSelectDeparture} />
              </ErrorBoundary>
            )}
          </AnimatePresence>
          <ErrorBoundary
            fallback={<div className="p-4 text-center text-gray-500 dark:text-gray-400">Route search unavailable</div>}
          >
            <RouteResults
              routes={routes}
              loading={loading}
              error={error}
              notice={notice}
              selectedId={selectedRouteId}
              onSelect={selectRoute}
              delayVehicles={delayData.data?.vehicles}
              trafficEstimates={delayData.data?.estimates}
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
      <AnimatePresence>
        {toast && !showIssues && (
          <DelayToast
            key="delay-toast"
            text={toast.text}
            onDismiss={dismissToast}
            onClick={() => {
              setShowIssues(true)
              dismissToast()
            }}
          />
        )}
      </AnimatePresence>

      {/* Issues panel - above the issues button */}
      <AnimatePresence>
        {showIssues && (
          <IssuesPanel
            key="issues"
            vehicles={activeDelayedVehicles}
            alerts={activeAlerts}
            trafficEstimates={activeTrafficEstimates}
            delayStatus={delayData.status}
            alertStatus={alertData.status}
            onSelectVehicle={handleSelectDelayedVehicle}
            onLocateAlert={setFocusedAlert}
            onClose={() => setShowIssues(false)}
          />
        )}
      </AnimatePresence>

      {/* Nearby-stops panel - above the nearby button; mutually exclusive
          with the issues panel so the two never stack in the same corner */}
      <AnimatePresence>
        {showNearby && (
          <ErrorBoundary
            key="nearby"
            fallback={
              <div className="absolute bottom-24 right-4 z-40 w-80 p-4 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
                Nearby stops unavailable
              </div>
            }
          >
            <NearbyPanel
              onSelectStop={(name, lat, lng, stopId) => {
                handleViewStopBoard(name, lat, lng, stopId)
                setShowNearby(false)
              }}
              onClose={() => setShowNearby(false)}
            />
          </ErrorBoundary>
        )}
      </AnimatePresence>

      {/* Bottom-right FAB row. A single flex container rather than per-button
          right-N offsets: NotificationToggle is conditional on pushSupported,
          so a hardcoded offset for a 4th button would leave a visible gap
          whenever push isn't supported. This makes <main> the nearest
          positioned ancestor for any absolute badge inside these buttons —
          see the `relative` added to IssuesButton's own <button>. */}
      <div className="absolute bottom-6 right-4 z-30 flex items-center gap-2 pointer-events-auto">
        <NearbyButton
          active={showNearby}
          onClick={() => {
            setShowNearby((prev) => !prev)
            setShowIssues(false)
          }}
        />

        {pushSupported && (
          <NotificationToggle
            enabled={notificationsEnabled}
            busy={notificationsBusy}
            onToggle={() => (notificationsEnabled ? disableNotifications() : enableNotifications())}
          />
        )}

        <IssuesButton
          active={showIssues}
          count={delayedVehicleCount + activeAlerts.length}
          degraded={delayData.status === 'unavailable' || alertData.status === 'unavailable'}
          onClick={() => {
            setShowIssues((prev) => !prev)
            setShowNearby(false)
          }}
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
