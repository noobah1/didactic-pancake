import { OTP_BASE_URL, OTP_FETCH_TIMEOUT_MS } from '@/lib/constants'
import { TransportMode, RouteResult, RouteLeg, LegPlace, LegAlert } from '@/lib/types'
import { fetchStationPlatformIndex, resolvePlatform } from '@/lib/elron-platform'
import { mapAlertSeverity } from '@/lib/alert-severity'

// Tallinn's unified GTFS feed tags trolleybus routes with GTFS mode BUS (no
// TROLLEYBUS route_type in the data), so trip planning requests BUS for it too.
// See its use in planTrip: how far past OTP's own auto-sized search window
// to look before accepting that transit genuinely has nothing today.
const WIDE_SEARCH_WINDOW_SECONDS = 24 * 60 * 60

const MODE_TO_OTP: Record<TransportMode, string> = {
  bus: 'BUS',
  tram: 'TRAM',
  train: 'RAIL',
  ferry: 'FERRY',
  trolleybus: 'BUS',
  nightbus: 'BUS',
}

// leg.headsign is the trip's overall destination, static for the whole trip
// regardless of which stop a given leg boards/alights at (confirmed live: a
// Tallinn-Tartu leg that's part of a Tallinn-Valga service reports headsign
// "Valga", not "Tartu") — this is what lines up with Elron's own "sihtjaam"
// field, see elron-platform.ts.
const PLAN_QUERY = `
query Plan($from: InputCoordinates!, $to: InputCoordinates!, $modes: [TransportMode!], $numItineraries: Int!, $date: String, $time: String, $arriveBy: Boolean, $banned: InputBanned, $searchWindow: Long, $wheelchair: Boolean) {
  plan(
    from: $from,
    to: $to,
    transportModes: $modes,
    numItineraries: $numItineraries,
    date: $date,
    time: $time,
    arriveBy: $arriveBy,
    banned: $banned,
    searchWindow: $searchWindow,
    wheelchair: $wheelchair
  ) {
    itineraries {
      duration
      startTime
      endTime
      walkDistance
      legs {
        mode
        headsign
        start { scheduledTime estimated { time } }
        end { scheduledTime estimated { time } }
        from {
          name
          lat
          lon
          stop { gtfsId }
          departure { scheduledTime estimated { time } }
        }
        to {
          name
          lat
          lon
          stop { gtfsId }
          arrival { scheduledTime estimated { time } }
        }
        duration
        route { gtfsId shortName }
        trip { gtfsId wheelchairAccessible }
        realtimeState
        alerts {
          alertHeaderText
          alertDescriptionText
          alertSeverityLevel
        }
        legGeometry { points }
        intermediatePlaces {
          name
          lat
          lon
          stop { gtfsId }
          departure { scheduledTime estimated { time } }
          arrival { scheduledTime estimated { time } }
        }
      }
    }
  }
}
`

interface GqlTime {
  scheduledTime: string
  estimated?: { time: string } | null
}

interface GqlPlace {
  name?: string
  lat: number
  lon: number
  stop?: { gtfsId: string } | null
  departure?: GqlTime | null
  arrival?: GqlTime | null
}

interface GqlAlert {
  alertHeaderText?: string | null
  alertDescriptionText?: string | null
  alertSeverityLevel?: string | null
}

interface GqlLeg {
  mode: string
  headsign?: string | null
  start: GqlTime
  end: GqlTime
  from: GqlPlace
  to: GqlPlace
  duration: number
  route?: { gtfsId: string; shortName: string } | null
  trip?: { gtfsId: string; wheelchairAccessible?: string | null } | null
  realtimeState?: string | null
  alerts?: GqlAlert[] | null
  legGeometry?: { points: string } | null
  intermediatePlaces?: GqlPlace[] | null
}

interface GqlItinerary {
  duration: number
  startTime: number
  endTime: number
  walkDistance: number
  legs: GqlLeg[]
}

export interface PlanOptions {
  modes?: TransportMode[]
  dateTime?: string
  arriveBy?: boolean
  bannedTrips?: string
  // Plans a step-free journey. Estonia publishes almost no stop
  // accessibility (4 of 36,279 stops carry it) but good vehicle
  // accessibility (38% of trips), so this can't mean "only provably
  // accessible" — OTP is configured to penalize unknowns rather than ban
  // them (see otp/router-config.json), and each leg reports what is
  // actually known via RouteLeg.wheelchairAccessible.
  wheelchair?: boolean
}

export interface PlanResult {
  routes?: RouteResult[]
  notice?: string
  error?: string
  status?: number
}

// Extracted from /api/plan so the OTP query/mapping logic exists in exactly
// one place rather than being duplicated between an HTTP route and any
// other server-internal caller.
export async function planTrip(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  options: PlanOptions = {},
): Promise<PlanResult> {
  const transportModes: { mode: string }[] = [{ mode: 'WALK' }]
  if (options.modes?.length) {
    options.modes.forEach((m) => {
      const otpMode = MODE_TO_OTP[m]
      if (otpMode) transportModes.push({ mode: otpMode })
    })
  } else {
    transportModes.push({ mode: 'BUS' }, { mode: 'TRAM' }, { mode: 'RAIL' }, { mode: 'FERRY' })
  }

  const variables: Record<string, unknown> = {
    from: { lat: fromLat, lon: fromLng },
    to: { lat: toLat, lon: toLng },
    modes: transportModes,
    numItineraries: 5,
  }

  if (options.dateTime) {
    // dateTime comes as "2026-02-27T09:30" from the datetime-local input
    const [date, time] = options.dateTime.split('T')
    if (date) variables.date = date
    if (time) variables.time = time
  }

  if (options.arriveBy) {
    variables.arriveBy = true
  }

  if (options.wheelchair) {
    variables.wheelchair = true
  }

  // "Get alternatives" on a delay warning bans the specific trip(s) running
  // late instead of just re-issuing the identical query, which would almost
  // always come back with the exact same top itinerary.
  if (options.bannedTrips) {
    variables.banned = { trips: options.bannedTrips }
  }

  try {
    const primary = await fetchItineraries(variables)

    if (primary.hardError) {
      return { error: primary.hardError, status: 502 }
    }

    if (primary.itineraries.length > 0) {
      return { routes: await buildRoutes(primary.itineraries) }
    }

    // OTP sizes its own default search window from the typical service
    // frequency between the two nearest stops — for a sparse rural pairing
    // that estimate can come out too narrow and miss a real departure just
    // a couple hours later, returning NO_TRANSIT_CONNECTION_IN_SEARCH_WINDOW
    // even though a trip exists (confirmed live: a Tallinn–Kadrina-area
    // request at a specific time found nothing with OTP's own window, but
    // an explicit 6-hour window found one about 20 minutes later). Retry
    // once with a full day's window before concluding transit genuinely
    // has nothing today.
    const widened = await fetchItineraries({ ...variables, searchWindow: WIDE_SEARCH_WINDOW_SECONDS })
    if (widened.itineraries.length > 0) {
      return {
        routes: await buildRoutes(widened.itineraries),
        notice: 'Service is infrequent on this route — showing the next available departure.',
      }
    }

    // No itinerary at all — before giving up, check whether a plain walk is
    // even possible. A rural stop can genuinely have just one bus a day
    // (confirmed live: a real address matched to a stop with buses at
    // 09:20/13:18/15:25 and nothing else, so a request at 21:00 correctly
    // finds nothing to ride) — "No routes found" alone reads as broken
    // rather than "already gone for today," and leaves the rider with
    // nothing actionable. Falling back to a walking itinerary at least
    // answers "can I still get there," with a notice explaining why transit
    // didn't turn up anything.
    const walkOnly = await fetchItineraries({ ...variables, modes: [{ mode: 'WALK' }], numItineraries: 1 })
    if (walkOnly.itineraries.length > 0) {
      return {
        routes: mapItineraries(walkOnly.itineraries),
        notice: 'No transit found for this time — showing a walking route instead.',
      }
    }

    return { error: 'No routes found', status: 404 }
  } catch (error) {
    console.error('Failed to fetch route plan:', error)
    return { error: 'Route planning service unavailable', status: 502 }
  }
}

async function fetchItineraries(
  variables: Record<string, unknown>,
): Promise<{ itineraries: GqlItinerary[]; hardError?: string }> {
  const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: PLAN_QUERY, variables }),
    cache: 'no-store',
    signal: AbortSignal.timeout(OTP_FETCH_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`OTP returned ${response.status}`)
  }

  const data = await response.json()
  const itineraries: GqlItinerary[] = data.data?.plan?.itineraries || []

  if (data.errors?.length) {
    const nonFareErrors = data.errors.filter((e: { message?: string }) => !e.message?.includes('currency'))
    if (nonFareErrors.length > 0 && itineraries.length === 0) {
      console.error('OTP GraphQL errors:', data.errors)
      return { itineraries: [], hardError: nonFareErrors[0].message || 'Route planning failed' }
    }
  }

  return { itineraries }
}

// mapItineraries plus Elron platform enrichment for any RAIL legs — kept as
// the one path both the primary and widened-search branches of planTrip go
// through, so a train leg never appears without a platform lookup attempt
// regardless of which OTP search actually produced it.
async function buildRoutes(itineraries: GqlItinerary[]): Promise<RouteResult[]> {
  const routes = mapItineraries(itineraries)
  await enrichTrainPlatforms(itineraries, routes)
  return routes
}

function formatTallinnHHMM(isoTime: string): string {
  return new Date(isoTime).toLocaleTimeString('en-GB', { timeZone: 'Europe/Tallinn', hour: '2-digit', minute: '2-digit' })
}

// Attaches a departure platform to each RAIL leg's `from` and an arrival
// platform to its `to`, mutating the already-built RouteResult[] in place —
// itineraries and routes share the same [itinerary][leg] indexing since
// mapItineraries is a plain 1:1 map with no filtering. See
// src/lib/elron-platform.ts for how the lookup itself works (this mirrors
// /api/stop-board/route.ts's enrichment).
async function enrichTrainPlatforms(itineraries: GqlItinerary[], routes: RouteResult[]): Promise<void> {
  const stationNames = new Set<string>()
  for (const it of itineraries) {
    for (const leg of it.legs) {
      if (leg.mode !== 'RAIL') continue
      if (leg.from.name) stationNames.add(leg.from.name)
      if (leg.to.name) stationNames.add(leg.to.name)
    }
  }
  if (stationNames.size === 0) return

  const indexes = new Map(
    await Promise.all(
      [...stationNames].map(
        async (name) => [name, await fetchStationPlatformIndex(name)] as [string, Awaited<ReturnType<typeof fetchStationPlatformIndex>>],
      ),
    ),
  )

  itineraries.forEach((it, i) => {
    it.legs.forEach((leg, j) => {
      if (leg.mode !== 'RAIL') return
      const headsign = leg.headsign || ''
      const routeLeg = routes[i].legs[j]

      const fromIndex = leg.from.name ? indexes.get(leg.from.name) : null
      const fromMatch = fromIndex && resolvePlatform(fromIndex, formatTallinnHHMM(leg.start.scheduledTime), headsign)
      if (fromMatch) {
        routeLeg.from.platform = fromMatch.platform
        routeLeg.from.platformChanged = fromMatch.changed
      }

      const toIndex = leg.to.name ? indexes.get(leg.to.name) : null
      const toMatch = toIndex && resolvePlatform(toIndex, formatTallinnHHMM(leg.end.scheduledTime), headsign)
      if (toMatch) {
        routeLeg.to.platform = toMatch.platform
        routeLeg.to.platformChanged = toMatch.changed
      }
    })
  })
}

function mapItineraries(itineraries: GqlItinerary[]): RouteResult[] {
  return itineraries.map((it, index) => ({
    id: `route-${index}`,
    duration: it.duration,
    startTime: new Date(it.startTime).toISOString(),
    endTime: new Date(it.endTime).toISOString(),
    walkDistance: it.walkDistance,
    legs: it.legs.map(
      (leg): RouteLeg => ({
        mode: leg.mode === 'WALK' ? 'walk' : otpModeToLocal(leg.mode),
        from: mapPlace(leg.from),
        to: mapPlace(leg.to),
        startTime: resolveTime(leg.start),
        endTime: resolveTime(leg.end),
        duration: leg.duration,
        route: leg.route?.shortName || undefined,
        routeGtfsId: leg.route?.gtfsId || undefined,
        tripId: leg.trip?.gtfsId || undefined,
        wheelchairAccessible: mapWheelchair(leg.trip?.wheelchairAccessible),
        alerts: mapLegAlerts(leg.alerts),
        realtimeState: mapRealtimeState(leg.realtimeState),
        intermediateStops: leg.intermediatePlaces?.map(mapPlace) || undefined,
        legGeometry: leg.legGeometry || undefined,
      }),
    ),
  }))
}

// GTFS wheelchair_accessible is a three-state field, and the third state is
// the common one here (61% of Estonian trips) — collapsing "no information"
// into "not accessible" would state something the feed never said, the same
// distinction the delay board draws between a measured and an estimated
// delay. Undefined means unknown; the caller must not render it as a no.
function mapWheelchair(value: string | null | undefined): boolean | undefined {
  if (value === 'POSSIBLE') return true
  if (value === 'NOT_POSSIBLE') return false
  return undefined
}

function mapLegAlerts(alerts: GqlAlert[] | null | undefined): LegAlert[] | undefined {
  if (!alerts?.length) return undefined
  return alerts.map((a) => ({
    headerText: a.alertHeaderText || '',
    descriptionText: a.alertDescriptionText || '',
    severity: mapAlertSeverity(a.alertSeverityLevel),
  }))
}

function mapRealtimeState(value: string | null | undefined): RouteLeg['realtimeState'] {
  switch (value) {
    case 'SCHEDULED': return 'scheduled'
    case 'UPDATED': return 'updated'
    case 'CANCELED': return 'canceled'
    case 'ADDED': return 'added'
    case 'MODIFIED': return 'modified'
    default: return undefined
  }
}

function otpModeToLocal(otpMode: string): TransportMode {
  const map: Record<string, TransportMode> = {
    BUS: 'bus',
    TRAM: 'tram',
    RAIL: 'train',
    FERRY: 'ferry',
  }
  return map[otpMode] || 'bus'
}

function resolveTime(t: GqlTime): string {
  return t.estimated?.time || t.scheduledTime
}

function mapPlace(place: GqlPlace): LegPlace {
  return {
    name: place.name || '',
    lat: place.lat,
    lng: place.lon,
    stopId: place.stop?.gtfsId || undefined,
    departure: place.departure
      ? (place.departure.estimated?.time || place.departure.scheduledTime)
      : undefined,
    arrival: place.arrival
      ? (place.arrival.estimated?.time || place.arrival.scheduledTime)
      : undefined,
  }
}
