'use client'
import { useJourneyMonitor } from '@/hooks/use-journey-monitor'
import { DelayBanner } from '@/components/DelayBanner'
import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Image from 'next/image'
const logo3 = '/logo3.png'
import { SearchPanel } from '@/components/SearchPanel'
import { RouteResults } from '@/components/RouteResults'
import { MapView } from '@/components/MapView'
import { IssuesButton } from '@/components/IssuesButton'
import { IssuesPanel } from '@/components/IssuesPanel'
import { NearbyButton } from '@/components/NearbyButton'
import { NearbyPanel } from '@/components/NearbyPanel'
import { FilterButton } from '@/components/FilterButton'
import { FilterPanel } from '@/components/FilterPanel'
import { DelayToast } from '@/components/DelayToast'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { TimetablePanel } from '@/components/TimetablePanel'
import { StopBoard, StopBoardTarget } from '@/components/StopBoard'
import { TransportMode, VehiclePosition, ServiceAlert, StopDeparture, SharePosition, RouteLeg } from '@/lib/types'
import { RidingPanel } from '@/components/RidingPanel'
import { useRidingMode } from '@/hooks/use-riding-mode'
import { ALL_MODES, CITIES, CityDef, TALLINN_CENTER, CITY_RELEVANCE_RADIUS_M } from '@/lib/constants'
import { OVERVIEW_THRESHOLD_SEC, findVehicleForLeg, distanceMeters } from '@/lib/delay'
import { resolveTravellerPosition } from '@/lib/traveller-position'
import { DelayedVehicle } from '@/app/api/delays/route'
import { useVehicles } from '@/hooks/use-vehicles'
import { useRoutePlan } from '@/hooks/use-route-plan'
import { useAlerts } from '@/hooks/use-alerts'
import { useDelays } from '@/hooks/use-delays'
import { useDelayToast } from '@/hooks/use-delay-toast'
import { useTheme } from '@/hooks/use-theme'
import { useTranslation } from '@/lib/i18n/context'
import { useFavorites } from '@/hooks/use-favorites'
import { cacheFavoriteDeparture } from '@/hooks/use-favorite-departure'
import { LineFilter, applyLineFilter } from '@/lib/vehicle-filter'

function HomeContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  // No return value needed — mounting this is what keeps the app's theme
  // synced to the OS/browser preference (including a live change while the
  // tab stays open); see use-theme.ts.
  useTheme()
  const { t, locale } = useTranslation()

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
  const [activeModes] = useState<TransportMode[]>(
    modesFromUrl ? (modesFromUrl.split(',') as TransportMode[]) : [...ALL_MODES],
  )
  // Lifted here rather than kept local to SearchPanel so the "Get
  // alternatives" re-search below (which calls the plan hook directly) can
  // still honor it.
  const [wheelchair, setWheelchair] = useState(false)
  // Set when a marker click can't produce a route shape at all (see
  // MapView's onRouteShapeError) — otherwise that click just silently does
  // nothing, indistinguishable from the tap not registering.
  const [routeShapeError, setRouteShapeError] = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<VehiclePosition | null>(null)
  const [selectedVehicleDelayed, setSelectedVehicleDelayed] = useState(false)
  // The trip the delay board itself already matched this vehicle to, if
  // selection came from there — passed to TimetablePanel so its very first
  // fetch is hinted instead of running an entirely independent, unhinted
  // match that can (and often does) land on a different trip than the
  // board just showed for the same vehicle. Cleared on a plain map click,
  // which has no such trip to hand over.
  const [selectedVehicleInitialTripId, setSelectedVehicleInitialTripId] = useState<string | null>(null)
  // A vehicle handleSelectLine found via its nationwide, city-unscoped
  // fallback fetch (see that function's own comments) — set alongside
  // selectedVehicle only in that one branch. vehicleData is always scoped to
  // activeCities, so a line picked outside the map's currently active
  // cities (e.g. Tartu's bus 5 while only Tallinn is active) resolves a real
  // vehicle that never appears in vehicleData itself: MapView draws markers
  // strictly from its vehicles prop, so without this the camera would fly
  // to the right town and the route/timetable would open, but no dot would
  // ever show up — exactly as if nothing had been found. Merged into the
  // vehicles list handed to MapView/TimetablePanel below so that one vehicle
  // still gets a marker despite being outside the scoped fetch. Cleared on
  // every other selection path so it never lingers on top of an unrelated
  // pick.
  const [extraMapVehicle, setExtraMapVehicle] = useState<VehiclePosition | null>(null)
  const [showIssues, setShowIssues] = useState(false)
  const [showNearby, setShowNearby] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  // The filter actually applied to the map right now.
  const [lineFilter, setLineFilter] = useState<LineFilter | null>(null)
  // The line ready to apply — set whenever a line is searched or a vehicle
  // is tapped, independent of whether the filter itself is on. Kept separate
  // from lineFilter so picking a line only offers the filter (badge on the
  // FAB) rather than silently narrowing the map underneath the rider.
  const [armedLine, setArmedLine] = useState<LineFilter | null>(null)
  const [focusedAlert, setFocusedAlert] = useState<ServiceAlert | null>(null)
  const [stopBoard, setStopBoard] = useState<StopBoardTarget | null>(null)
  // A line result picked from the departure-board search — flown to
  // immediately on pick, same "fly the camera there" treatment as
  // focusStop/focusAlert. Needed because handleSelectLine's own vehicle
  // lookup can legitimately miss (the picked line simply has no bus/train
  // currently mid-trip), and previously a miss left the map exactly where
  // it was — for a line outside the map's current view (e.g. Tartu's bus 5
  // while centered on Tallinn) that read as the click doing nothing at all,
  // even though the search itself found the right line. Flying here always,
  // whether or not a live vehicle also gets found, means picking a line
  // always visibly goes to that line's own town.
  const [focusLine, setFocusLine] = useState<{ lat: number; lng: number } | null>(null)

  const testAlerts = searchParams.get('test_alerts') === '1'

  const vehicleData = useVehicles(activeModes, activeCities)
  // Keeps extraMapVehicle's position live once handleSelectLine's nationwide
  // fallback finds a vehicle outside activeCities' scope — vehicleData never
  // covers it (it's fetched scoped to activeCities), so without a poll of its
  // own that vehicle's position would freeze at the moment it was picked,
  // making both its map marker and TimetablePanel's live schedule (which
  // re-reads that position every 10s) increasingly wrong as the real vehicle
  // keeps moving. Disabled whenever there's no extra vehicle, so this never
  // runs an unscoped nationwide poll for nothing.
  const extraVehicleData = useVehicles(extraMapVehicle ? [extraMapVehicle.mode] : [], [], !!extraMapVehicle)
  const { routes, loading, error, notice, search, clear, selectedRouteId, selectRoute, loadSharedRoute, setShareError } = useRoutePlan()
  const alertData = useAlerts(testAlerts)
  const delayData = useDelays(activeCities)
  const { findFavorite } = useFavorites()
  // The from/to of the search that produced the current `routes`, kept only
  // to check afterwards whether it matches a saved favorite -- SearchPanel
  // owns the actual from/to input state, this is just enough to cache a
  // favorite's next departure (see use-favorite-departure.ts) without lifting
  // its whole form state up here.
  const [lastSearchPlaces, setLastSearchPlaces] = useState<{ fromPlace: string; toPlace: string } | null>(null)

  // A journey opened from a shared link (see RouteResults' Share button)
  // arrives as a fully-formed RouteResult, not a search to re-run — pull it
  // in once on load, then drop the param so it doesn't linger in the URL or
  // re-fetch on a later refresh (localStorage already has it from here on).
  const shareId = searchParams.get('share')
  // The sharer's own live position, if they've opted in (see RouteResults'
  // "Share your live location" toggle and use-live-share.ts) — polled below
  // for as long as this is still the journey on screen. `sharing` is a
  // separate flag from `position` being present: it's what gates whether
  // resolveTravellerPosition is allowed to infer a position from the
  // vehicle/timetable once the position itself goes stale (see that
  // function's own comment on why a present-but-stale position alone isn't
  // proof consent is still current).
  const [sharedPosition, setSharedPosition] = useState<SharePosition | null>(null)
  const [sharing, setSharing] = useState(false)
  // Kept separate from the reactive `shareId` above: that one is read
  // straight from the URL and gets stripped by the router.replace below a
  // moment after load, but polling needs to keep targeting the same share
  // for as long as its journey stays selected.
  const [liveShareId, setLiveShareId] = useState<string | null>(null)
  const [liveShareRouteId, setLiveShareRouteId] = useState<string | null>(null)
  useEffect(() => {
    if (!shareId) return
    let cancelled = false
    fetch(`/api/share?id=${encodeURIComponent(shareId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return
        loadSharedRoute(data.route)
        setSharedPosition(data.position ?? null)
        setSharing(!!data.sharing)
        setLiveShareId(shareId)
        setLiveShareRouteId(data.route.id)
      })
      .catch(() => {
        if (!cancelled) setShareError(t('page.shareExpired'))
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

  // Poll for the sharer's position while their journey is the one on screen.
  // Stops (and clears the marker) the moment the sharer turns live sharing
  // off — /api/share then simply stops returning a position/sharing flag.
  useEffect(() => {
    if (!liveShareId) return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/share?id=${encodeURIComponent(liveShareId)}`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          setSharedPosition(data.position ?? null)
          setSharing(!!data.sharing)
        }
      } catch {
        // Transient — the next tick will just try again.
      }
    }
    const interval = setInterval(tick, 20_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [liveShareId])

  // Once the viewer navigates away from the shared journey (a new search, a
  // different route), the position no longer belongs on screen and there's
  // no reason to keep polling for it.
  useEffect(() => {
    if (liveShareRouteId && selectedRouteId !== liveShareRouteId) {
      setLiveShareId(null)
      setLiveShareRouteId(null)
      setSharedPosition(null)
      setSharing(false)
    }
  }, [selectedRouteId, liveShareRouteId])

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

  const handleSearch = (fromPlace: string, toPlace: string, modes: TransportMode[], dateTime?: string, arriveBy?: boolean, wc?: boolean) => {
    setStopBoard(null)
    search(fromPlace, toPlace, modes, dateTime, arriveBy, undefined, wc)
    setLastSearchPlaces({ fromPlace, toPlace })
  }

  // Opportunistic-only caching (see use-favorite-departure.ts): whenever a
  // search actually completes and its from/to is a saved favorite, stash the
  // top itinerary's first transit leg so the favorite's chip can still show
  // "last known" departure info offline, even though nothing here polls a
  // favorite in the background. fromPlace/toPlace are always "lat,lng" --
  // every caller of onSearch (LocationInput picks, favorite/recent/home-work
  // chips) resolves to coordinates before calling it.
  useEffect(() => {
    if (!lastSearchPlaces || routes.length === 0) return
    const [fromLat, fromLng] = lastSearchPlaces.fromPlace.split(',').map(Number)
    const [toLat, toLng] = lastSearchPlaces.toPlace.split(',').map(Number)
    if ([fromLat, fromLng, toLat, toLng].some((n) => Number.isNaN(n))) return
    const favorite = findFavorite(fromLat, fromLng, toLat, toLng)
    if (favorite) cacheFavoriteDeparture(favorite.id, routes)
  }, [routes, lastSearchPlaces, findFavorite])

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
    setExtraMapVehicle(null)
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
    setExtraMapVehicle(null)
  }

  // Line search (see SearchPanel's Departures-tab search, mixed in with
  // stops via /api/geocode) has no vehicle or trip to select up front — just
  // a mode + line code plus the picked result's own anchor coordinates — so
  // it has to find one itself rather than being handed one like the handlers
  // above. Checks the GPS-confirmed delay board
  // first (nationwide, not scoped to activeModes/activeCities, so a line
  // outside the map's current filters can still be found), then the already-
  // polled schedule-interpolated vehicleData. Both of those, though, only
  // ever cover what the map is currently showing: delayData's GPS is
  // Tallinn-only by feed, and vehicleData is fetched scoped to activeCities/
  // activeModes (verified live: useVehicles returns an empty list outright
  // when no city is active, and /api/vehicles otherwise filters everything
  // non-intercity down to just the active cities). The search box itself is
  // nationwide, so e.g. picking Tartu's "Line 2 (Bus)" while the map is
  // filtered to Tallinn would always report "not running" here even with a
  // real bus 2 out on the road — a mismatch between what the search can find
  // and what selecting a result can look up. Final fallback: a one-off fetch
  // to /api/vehicles scoped only to the picked mode, no cities filter, so it
  // always searches the whole country regardless of the map's own toggles.
  // Returns whether anything was found, so SearchPanel knows whether to show
  // its own "not running" message — deliberately never fabricates a
  // placeholder position for a miss, which would risk showing a fake
  // "confirmed" delay computed against a point no real vehicle is at (see
  // computeStatusFromGPS).
  // anchorLat/anchorLng are the picked line result's own anchor stop (e.g.
  // Tartu's bus 5, not Tallinn's) — the same line number legitimately runs in
  // a dozen-plus towns, so matching on mode+line alone and taking whichever
  // vehicle happens to come first grabbed the wrong town's bus whenever a
  // closer/earlier-indexed one shared the number. Picking the candidate
  // nearest the anchor keeps the result matching the town the rider actually
  // searched — and rejecting one that's still further than a town's own
  // plausible radius (e.g. Tallinn's own "line 2" turning up for a Tartu
  // "line 2" search, ~180km from the anchor, because it was simply the only
  // candidate on the Tallinn-only delay board) makes this branch fall through
  // to the next one instead of confidently showing the wrong city's bus.
  const handleSelectLine = async (mode: string, line: string, anchorLat: number, anchorLng: number): Promise<boolean> => {
    // Fly to the picked line's own town right away, independent of whether a
    // live vehicle turns up below — see focusLine's own comment for why.
    setFocusLine({ lat: anchorLat, lng: anchorLng })
    // Arm the filter FAB with this line right away too, same reasoning as
    // focusLine above — a rider searching a line wants "filter to this" on
    // offer even when no live vehicle for it turns up below. Replaces any
    // already-applied filter as well, so the badge and the map never show
    // two different lines at once.
    const armed: LineFilter = { mode: mode as TransportMode, line, anchor: { lat: anchorLat, lng: anchorLng } }
    setArmedLine(armed)
    setLineFilter((cur) => (cur ? armed : cur))
    const nearest = <T extends { lat: number; lng: number }>(candidates: T[]): T | undefined => {
      if (candidates.length === 0) return undefined
      const best = candidates.reduce((best, v) =>
        distanceMeters(v.lat, v.lng, anchorLat, anchorLng) < distanceMeters(best.lat, best.lng, anchorLat, anchorLng) ? v : best,
      )
      return distanceMeters(best.lat, best.lng, anchorLat, anchorLng) <= CITY_RELEVANCE_RADIUS_M ? best : undefined
    }

    const delayed = nearest((delayData.data?.vehicles || []).filter((v) => v.mode === mode && v.line === line))
    if (delayed) {
      handleSelectDelayedVehicle(delayed)
      return true
    }
    const scheduled = nearest((vehicleData.data?.vehicles || []).filter((v) => v.mode === mode && v.line === line))
    if (scheduled) {
      setSelectedVehicle(scheduled)
      setSelectedVehicleInitialTripId(null)
      setSelectedVehicleDelayed(false)
      setExtraMapVehicle(null)
      return true
    }
    try {
      const res = await fetch(`/api/vehicles?modes=${encodeURIComponent(mode)}`)
      if (res.ok) {
        const data: { vehicles: VehiclePosition[] } = await res.json()
        const nationwide = nearest(data.vehicles.filter((v) => v.mode === mode && v.line === line))
        if (nationwide) {
          setSelectedVehicle(nationwide)
          setSelectedVehicleInitialTripId(null)
          setSelectedVehicleDelayed(false)
          // Not necessarily inside vehicleData's activeCities-scoped fetch
          // (that's the whole reason this branch had to run its own
          // nationwide request) — see extraMapVehicle's own comment.
          setExtraMapVehicle(nationwide)
          return true
        }
      }
    } catch {
      // Non-critical: fall through to "not found" below.
    }
    return false
  }

  const handleVehicleClick = (vehicle: VehiclePosition | null) => {
    setSelectedVehicle(vehicle)
    setSelectedVehicleInitialTripId(null)
    setSelectedVehicleDelayed(false)
    setExtraMapVehicle(null)
    if (vehicle) {
      const armed: LineFilter = { mode: vehicle.mode, line: vehicle.line, anchor: { lat: vehicle.lat, lng: vehicle.lng } }
      setArmedLine(armed)
      setLineFilter((cur) => (cur ? armed : cur))
    } else {
      setArmedLine(null)
    }
  }

  // "All" (or none) selected means no city filter is actually active — show
  // everything nationwide, same as /api/vehicles treats an empty cities param.
  const showAllCities = activeCities.length === 0 || activeCities.length === CITIES.length

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

  // Resolves the shared journey's traveller marker (see MapView's own
  // TRAVELLER_MARKER_STYLE) from whatever's freshest: a real GPS fix, the
  // live vehicle running the current leg, or the timetable — see
  // traveller-position.ts's tier ladder. Only computed for the route that
  // actually is the shared one (liveShareRouteId), same guard the raw
  // sharedPosition prop used before this.
  const travellerPosition = useMemo(() => {
    if (!selectedRoute || selectedRoute.id !== liveShareRouteId) return null
    return resolveTravellerPosition({
      route: selectedRoute,
      position: sharedPosition,
      sharing,
      delayVehicles: delayData.data?.vehicles,
      vehicles: vehicleData.data?.vehicles,
      nowMs,
      locale,
    })
  }, [selectedRoute, liveShareRouteId, sharedPosition, sharing, delayData.data?.vehicles, vehicleData.data?.vehicles, nowMs, locale])

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

  // "I'm on this" — see use-riding-mode.ts. Only one session at a time,
  // always against a leg of the currently selected route (RouteCard's own
  // toggle only ever renders while its route is selected), so switching or
  // closing the selected route is exactly when riding should stop too.
  const [ridingLeg, setRidingLeg] = useState<RouteLeg | null>(null)
  useEffect(() => {
    setRidingLeg(null)
  }, [selectedRouteId])
  const { progress: ridingProgress, error: ridingError } = useRidingMode(ridingLeg, () => setRidingLeg(null))

  // Sync extraMapVehicle (and the selectedVehicle it was set alongside, in
  // handleSelectLine's nationwide branch) to each fresh position reported by
  // extraVehicleData — see that hook's own comment for why this is needed.
  useEffect(() => {
    if (!extraMapVehicle) return
    const fresh = extraVehicleData.data?.vehicles?.find((v) => v.id === extraMapVehicle.id)
    if (!fresh || fresh === extraMapVehicle) return
    setExtraMapVehicle(fresh)
    setSelectedVehicle((prev) => (prev?.id === fresh.id ? fresh : prev))
  }, [extraVehicleData.data, extraMapVehicle])

  // Self-dismissing, like the share-link error toast in RouteResults —
  // this is a one-off notice about a single click, not a state the rider
  // needs to keep looking at.
  useEffect(() => {
    if (!routeShapeError) return
    const timer = setTimeout(() => setRouteShapeError(false), 4000)
    return () => clearTimeout(timer)
  }, [routeShapeError])

  // vehicleData is scoped to activeCities, so a vehicle handleSelectLine
  // found via its nationwide fallback (see extraMapVehicle's own comment)
  // can be entirely missing from it — appending it here is what actually
  // gets that vehicle a marker on the map instead of just a camera move.
  const mapVehicles = useMemo(() => {
    if (!extraMapVehicle) return vehicleData.data?.vehicles
    if (vehicleData.data?.vehicles?.some((v) => v.id === extraMapVehicle.id)) return vehicleData.data.vehicles
    return [...(vehicleData.data?.vehicles || []), extraMapVehicle]
  }, [vehicleData.data?.vehicles, extraMapVehicle])

  // Applied after extraMapVehicle is merged in -- a line filter matching that
  // vehicle should still keep it visible, same as any other vehicle on the
  // map.
  const filteredMapVehicles = useMemo(() => applyLineFilter(mapVehicles, lineFilter), [mapVehicles, lineFilter])

  return (
    <main className="h-dvh relative overflow-hidden">
      {/* Fullscreen map base layer */}
      <ErrorBoundary
        fallback={
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 dark:text-gray-400">
            {t('page.mapUnavailable')}
          </div>
        }
      >
        <MapView
          vehicles={filteredMapVehicles}
          activeModes={activeModes}
          selectedRoute={selectedRoute}
          journeyVehicles={journeyVehicles}
          travellerPosition={travellerPosition}
          selectedVehicle={selectedVehicle}
          highlightDelay={selectedVehicleDelayed}
          // Only the disruption the user actually picked from the issues
          // panel gets drawn — passing every active alert here drew every
          // piece of roadwork on the map the instant the panel opened.
          incidents={showIssues && focusedAlert ? [focusedAlert] : undefined}
          cities={activeCities}
          focusAlert={focusedAlert}
          focusStop={stopBoard}
          focusLine={focusLine}
          onVehicleClick={handleVehicleClick}
          onRouteShapeError={() => setRouteShapeError(true)}
        />
      </ErrorBoundary>

      {/* Timetable panel - bottom left */}
      {selectedVehicle && (
        <TimetablePanel
          key="timetable"
          vehicle={selectedVehicle}
          vehicles={mapVehicles}
          initialTripId={selectedVehicleInitialTripId}
          onClose={() => { setSelectedVehicle(null); setSelectedVehicleInitialTripId(null); setExtraMapVehicle(null) }}
          onLateChange={setSelectedVehicleDelayed}
        />
      )}

      {/* Floating UI column - top center. On mobile it spans full width, leaving just
          a gutter on the right to clear the map's zoom/locate controls, instead of
          shrinking the whole box down; from sm: up it's centered and capped as before. */}
      <div
        id="floating-ui-column"
        className="absolute top-3 left-3 right-11 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-30 sm:w-[88%] sm:max-w-lg pointer-events-none"
      >
        <div className="pointer-events-auto">
          <SearchPanel onSearch={handleSearch} onClear={handleClear} modes={activeModes} activeCities={activeCities} onCityToggle={handleCityToggle} onCountyToggle={handleCountyToggle} onSetAllCities={handleSetAllCities} wheelchair={wheelchair} onWheelchairToggle={() => setWheelchair((w) => !w)} onViewStopBoard={handleViewStopBoard} onSelectLine={handleSelectLine} />
        </div>
        {/* Vehicle markers on the map are otherwise silent about their own
            data source going down — a rider watching a frozen or empty map
            has no way to tell "no vehicles right now" from "tracking is
            broken." Mirrors the same live/stale/unavailable language the
            issues button and nearby panel already use elsewhere. */}
        {vehicleData.status === 'unavailable' && (
          <div className="pointer-events-auto mt-2 flex items-center gap-1.5 px-3 py-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300">
            <span className="text-red-500">⚠️</span>
            {t('page.vehicleTrackingUnavailable')}
          </div>
        )}
        {vehicleData.status === 'stale' && (
          <div className="pointer-events-auto mt-2 flex items-center gap-1.5 px-3 py-2 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-300">
            <span className="text-amber-500">⚠️</span>
            {t('page.vehicleTrackingStale')}
          </div>
        )}
        {ridingLeg && (
          <div className="pointer-events-auto mt-2">
            <RidingPanel leg={ridingLeg} progress={ridingProgress} error={ridingError} onStop={() => setRidingLeg(null)} />
          </div>
        )}
        {stopBoard && (
          <div className="pointer-events-auto mt-8 sm:mt-0">
            <ErrorBoundary
              key="stop-board"
              fallback={<div className="p-4 text-center text-gray-500 dark:text-gray-400">{t('page.departureBoardUnavailable')}</div>}
            >
              <StopBoard stop={stopBoard} onClose={() => setStopBoard(null)} onSelectDeparture={handleSelectDeparture} />
            </ErrorBoundary>
          </div>
        )}
      </div>

      {/* Journey results - anchored to the bottom of the screen, Google Maps
          style: a full-width bottom sheet on mobile, a floating card near
          the bottom on larger screens, so it never competes with the From/To
          search fields pinned up top. */}
      <div
        id="route-results-sheet"
        className="fixed inset-x-0 bottom-0 sm:inset-x-auto sm:left-1/2 sm:right-auto sm:bottom-3 sm:-translate-x-1/2 z-40 sm:w-[88%] sm:max-w-lg pointer-events-none"
      >
        <div className="pointer-events-auto">
          <ErrorBoundary
            fallback={<div className="p-4 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-xl shadow-lg">{t('page.routeSearchUnavailable')}</div>}
          >
            {/* Rendered above the results card (not below) so it reads as a
                warning floating over the sheet rather than getting pushed
                off-screen under the bottom-anchored card. */}
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
                    wheelchair,
                  )
                }
              }}
              onDismiss={dismissWarning}
            />
            <RouteResults
              routes={routes}
              loading={loading}
              error={error}
              notice={notice}
              selectedId={selectedRouteId}
              onSelect={selectRoute}
              onClose={handleClear}
              delayVehicles={delayData.data?.vehicles}
              trafficEstimates={delayData.data?.estimates}
              ridingTripId={ridingLeg?.tripId ?? null}
              onToggleRiding={(leg) => setRidingLeg((cur) => (cur?.tripId === leg.tripId ? null : leg))}
            />
          </ErrorBoundary>
        </div>
      </div>

      {/* Delay toast - briefly announces newly-detected delays */}
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

      {/* Route-shape toast - a marker click that couldn't load any route
          data would otherwise look like the tap just didn't register.
          Deferred behind the delay toast (same corner) rather than dropped
          outright, since a route-shape failure isn't time-sensitive. */}
      {routeShapeError && !toast && (
        <DelayToast
          key="route-shape-toast"
          text={t('page.routeShapeUnavailable')}
          onDismiss={() => setRouteShapeError(false)}
        />
      )}

      {/* Issues panel - above the issues button */}
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

      {/* Nearby-stops panel - above the nearby button; mutually exclusive
          with the issues panel so the two never stack in the same corner */}
      {showNearby && (
        <ErrorBoundary
          key="nearby"
          fallback={
            <div className="absolute bottom-24 right-4 z-40 w-80 p-4 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
              {t('page.nearbyStopsUnavailable')}
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

      {/* Line-filter panel - above the filter button; mutually exclusive
          with the issues/nearby panels so at most one ever occupies this
          corner. */}
      {showFilter && (
        <FilterPanel
          vehicles={vehicleData.data?.vehicles}
          value={lineFilter}
          onChange={(next) => {
            setLineFilter(next)
            setArmedLine(next)
          }}
          onClose={() => setShowFilter(false)}
        />
      )}

      {/* Bottom-right FAB row. This makes <main> the nearest positioned
          ancestor for any absolute badge inside these buttons — see the
          `relative` added to IssuesButton's own <button>. z-45 (above the
          z-40 route-results sheet) so these stay reachable on mobile even
          when the bottom sheet's full-width card is tall enough to reach
          this corner, instead of getting buried under it. */}
      <div className="absolute bottom-6 right-4 z-[45] flex items-center gap-2 pointer-events-auto">
        <FilterButton
          active={!!lineFilter}
          armedLine={armedLine?.line ?? null}
          onToggle={() => setLineFilter((cur) => (cur ? null : armedLine))}
          onOpenPanel={() => {
            setShowFilter((prev) => !prev)
            setShowNearby(false)
            setShowIssues(false)
          }}
        />

        <NearbyButton
          active={showNearby}
          onClick={() => {
            setShowNearby((prev) => !prev)
            setShowIssues(false)
            setShowFilter(false)
          }}
        />

        <IssuesButton
          active={showIssues}
          count={delayedVehicleCount + activeAlerts.length}
          degraded={delayData.status === 'unavailable' || alertData.status === 'unavailable'}
          onClick={() => {
            setShowIssues((prev) => !prev)
            setShowNearby(false)
            setShowFilter(false)
          }}
        />
      </div>

      {/* Logo - bottom center */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none opacity-60">
        <Image src={logo3} alt={t('page.logoAlt')} width={80} height={24} className="w-auto" />
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
