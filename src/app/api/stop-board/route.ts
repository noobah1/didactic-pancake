import { NextResponse } from 'next/server'
import { OTP_BASE_URL, OTP_FETCH_TIMEOUT_MS } from '@/lib/constants'
import { StopBoardData, StopDeparture, TransportMode } from '@/lib/types'
import { fetchStationPlatformIndex, resolvePlatform } from '@/lib/elron-platform'
import { dedupeDepartures } from '@/lib/feed-dedupe'
import { fetchSiriDepartures, getSiriId, siriDelayFor, SiriDeparture } from '@/lib/tallinn-siri'

const STOP_FIELDS = `
  gtfsId
  name
  lat
  lon
  stoptimesWithoutPatterns(startTime: $startTime, numberOfDepartures: $numberOfDepartures, omitCanceled: true) {
    scheduledDeparture
    realtimeDeparture
    realtime
    serviceDay
    headsign
    trip {
      gtfsId
      route { shortName mode }
    }
  }
`

// /api/geocode merges every physical stop sharing a name (separate bus bays,
// a tram platform across the road, etc.) into one search result carrying all
// their stopIds — this builds one query aliasing stop0, stop1, ... so a
// multi-platform board still costs a single OTP round trip.
function buildStopBoardQuery(count: number): string {
  const vars = Array.from({ length: count }, (_, i) => `$stopId${i}: String!`).join(', ')
  const fields = Array.from({ length: count }, (_, i) => `stop${i}: stop(id: $stopId${i}) {${STOP_FIELDS}}`).join('\n')
  return `query StopBoard($numberOfDepartures: Int!, $startTime: Long!, ${vars}) {\n${fields}\n}`
}

interface GqlStoptime {
  scheduledDeparture: number
  realtimeDeparture: number
  realtime: boolean
  serviceDay: number
  headsign?: string | null
  trip: {
    gtfsId: string
    route: { shortName: string; mode: string }
  }
}

interface GqlStop {
  gtfsId: string
  name: string
  lat: number
  lon: number
  stoptimesWithoutPatterns: GqlStoptime[]
}

// Tallinn's unified GTFS feed tags trolleybus routes with GTFS mode BUS (no
// TROLLEYBUS route_type in the data — same limitation noted in trip-stops
// and route-shape) — a scheduled trolleybus departure shows here as "bus",
// since nothing in a schedule-only query can tell the two apart.
function otpModeToLocal(mode: string): TransportMode {
  const map: Record<string, TransportMode> = {
    BUS: 'bus',
    TRAM: 'tram',
    RAIL: 'train',
    FERRY: 'ferry',
  }
  return map[mode] || 'bus'
}

// How far back to look for trips scheduled in the past: a bus running late
// is still coming even though its timetable slot has gone by.
const LOOKBACK_SEC = 20 * 60
// A bus whose live-adjusted time is just behind us is still shown as "now"
// for this long, so a bus pulling in right now doesn't blink out.
const DEPARTED_GRACE_SEC = 30
const DELAYS_FETCH_TIMEOUT_MS = 3_000

// Live GPS-derived delay per trip, from this app's own /api/delays. Tallinn's
// OTP feed has no realtime, so without this the board only knows the
// timetable. Best effort: on any failure the board just stays schedule-only.
async function fetchTripDelays(): Promise<Map<string, number>> {
  try {
    const res = await fetch(`http://localhost:${process.env.PORT || 3000}/api/delays`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(DELAYS_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return new Map()
    const data: { vehicles?: { tripId: string; delaySeconds: number }[] } = await res.json()
    return new Map((data.vehicles || []).map((v) => [v.tripId, v.delaySeconds]))
  } catch {
    return new Map()
  }
}

const CACHE_TTL = 20_000
const cache = new Map<string, { data: StopBoardData; timestamp: number }>()

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const stopIdParam = searchParams.get('stopId')
  if (!stopIdParam) {
    return NextResponse.json({ error: 'stopId is required' }, { status: 400 })
  }
  // Comma-separated when /api/geocode merged several physical stops under
  // one name (see buildStopBoardQuery above) — otherwise just the one id.
  const stopIds = stopIdParam.split(',').map((id) => id.trim()).filter(Boolean)
  if (stopIds.length === 0) {
    return NextResponse.json({ error: 'stopId is required' }, { status: 400 })
  }

  const cached = cache.get(stopIdParam)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.data)
  }

  try {
    const nowSec = Math.floor(Date.now() / 1000)
    const variables: Record<string, string | number> = { numberOfDepartures: 30, startTime: nowSec - LOOKBACK_SEC }
    stopIds.forEach((id, i) => { variables[`stopId${i}`] = id })

    const delaysPromise = fetchTripDelays()
    const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: buildStopBoardQuery(stopIds.length),
        variables,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(OTP_FETCH_TIMEOUT_MS),
    })

    if (!response.ok) throw new Error(`OTP returned ${response.status}`)

    const data = await response.json()
    if (data.errors?.length) {
      return NextResponse.json({ error: data.errors[0].message }, { status: 502 })
    }

    const stops: GqlStop[] = stopIds
      .map((_, i) => data.data?.[`stop${i}`] as GqlStop | null)
      .filter((s): s is GqlStop => s != null)
    if (stops.length === 0) {
      return NextResponse.json({ error: 'Stop not found' }, { status: 404 })
    }

    // A trip could in principle call at more than one of the merged
    // platforms (a loop route) — key on trip+departure time so it only
    // shows once.
    const seen = new Set<string>()
    const tripDelays = await delaysPromise
    // Tallinn's live per-stop arrivals, keyed by OTP stop id. Stops outside
    // Tallinn's feed simply have no entry.
    const siriByStop = new Map<string, SiriDeparture[]>()
    await Promise.all(
      stops.map(async (stop) => {
        const siriId = await getSiriId(stop.gtfsId.replace(/^d+:/, ''))
        if (siriId) siriByStop.set(stop.gtfsId, await fetchSiriDepartures(siriId))
      }),
    )
    const allDepartures = stops
      .flatMap((stop) =>
        stop.stoptimesWithoutPatterns.map((st) => {
          // Live delay for this exact departure: Tallinn's per-stop feed
          // first, then the GPS-matched trip delay, else timetable only.
          const siriDelay = st.realtime
            ? undefined
            : siriDelayFor(
                siriByStop.get(stop.gtfsId) ?? [],
                st.trip.route.shortName,
                st.trip.route.mode === 'TRAM',
                st.scheduledDeparture,
              )
          return { st, stationName: stop.name, liveDelay: siriDelay ?? tripDelays.get(st.trip.gtfsId) }
        }),
      )
      .map(({ st, stationName, liveDelay }): StopDeparture & { stationName: string; scheduledHHMM: string } => ({
        tripId: st.trip.gtfsId,
        line: st.trip.route.shortName,
        mode: otpModeToLocal(st.trip.route.mode),
        headsign: st.headsign || '',
        // OTP's own realtime wins; otherwise apply the GPS-derived delay of
        // the vehicle matched to this trip, if any.
        departureEpochSec:
          st.serviceDay +
          (st.realtime ? st.realtimeDeparture : st.scheduledDeparture + (liveDelay ?? 0)),
        realtime: st.realtime || liveDelay !== undefined,
        delaySeconds: st.realtime ? st.realtimeDeparture - st.scheduledDeparture : liveDelay,
        stationName,
        // Elron's board keys departures by the originally SCHEDULED time, so
        // this must ignore realtime/delay — never derive it from
        // departureEpochSec above once that's gone realtime.
        scheduledHHMM: new Date((st.serviceDay + st.scheduledDeparture) * 1000).toLocaleTimeString('en-GB', {
          timeZone: 'Europe/Tallinn',
          hour: '2-digit',
          minute: '2-digit',
        }),
      }))
      // Drop what has really gone: the look-back above only exists to keep
      // late buses that are still on their way.
      .filter((dep) => dep.departureEpochSec >= nowSec - DEPARTED_GRACE_SEC)
      .filter((dep) => {
        const key = `${dep.tripId}-${dep.departureEpochSec}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => a.departureEpochSec - b.departureEpochSec)
    // Stale/duplicate train and ferry feeds (feed-dedupe.ts) -- after sorting
    // but before the cut to 12, so duplicates don't eat the visible slots.
    const departures = dedupeDepartures(allDepartures).slice(0, 12)

    // Only bother calling elron.ee when this board actually has a train on
    // it — the common case (bus/tram stops) never needs it.
    const trainStations = [...new Set(departures.filter((d) => d.mode === 'train').map((d) => d.stationName))]
    if (trainStations.length > 0) {
      const indexes = new Map(
        await Promise.all(
          trainStations.map(async (name): Promise<[string, Awaited<ReturnType<typeof fetchStationPlatformIndex>>]> => [
            name,
            await fetchStationPlatformIndex(name),
          ]),
        ),
      )
      for (const dep of departures) {
        if (dep.mode !== 'train') continue
        const index = indexes.get(dep.stationName)
        const match = index && resolvePlatform(index, dep.scheduledHHMM, dep.headsign)
        if (match) {
          dep.platform = match.platform
          dep.platformChanged = match.changed
        }
      }
    }

    const board: StopBoardData = {
      stopName: stops[0].name,
      lat: stops[0].lat,
      lng: stops[0].lon,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      departures: departures.map(({ stationName, scheduledHHMM, ...dep }) => dep),
    }
    cache.set(stopIdParam, { data: board, timestamp: Date.now() })
    return NextResponse.json(board)
  } catch (error) {
    console.error('Failed to fetch stop board:', error)
    if (cached) return NextResponse.json({ ...cached.data, stale: true })
    return NextResponse.json({ error: 'Failed to fetch stop board' }, { status: 502 })
  }
}
