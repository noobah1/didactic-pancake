import { DATEX_BASE_URL, DATEX_SRTI_CACHE_TTL, GPS_FEED_TIMEOUT_MS } from '../constants'
import { findAffectedRoutes, getMatchableRouteChunks } from '../tarktee'
import { ServiceAlert } from '../types'

// Tark Tee's authenticated DATEX II gate (see DATEX_BASE_URL's comment in
// constants.ts for why this exists alongside the free ArcGIS-based
// closures/detectors in tarktee.ts/detectors.ts). This module covers only
// the seven SRTI ("Safety Related Traffic Information") feeds — hazard
// events with no free-text description, unlike tarktee.ts's restrictions —
// so headerText below is authored here, reusing Transpordiamet's own
// Estonian feed names from the DATEX II gate's page. That matches this
// app's existing convention of leaving Tark Tee-sourced alert text
// untranslated regardless of UI language (see ServiceAlert.descriptionText
// in types.ts) rather than inventing a new bilingual pattern for one feed.
//
// Shipped without live hazard data to sample (registered in August; nothing
// icy/foggy to observe) — every shape below is instead confirmed against
// Transpordiamet's own example payload for each feed (linked from their
// DATEX II docs page, one per feed), and the API key itself was confirmed
// live against the real endpoints (200 OK, empty situation arrays — no
// active hazards at fetch time). A record whose sub-type isn't one of the
// values documented on that page is dropped rather than shown with a
// guessed label.

interface EnumValue {
  value?: string | null
}

// Every discriminating field below can come back as either a single object
// or an array of one, inconsistently between feeds (confirmed against
// Transpordiamet's own examples: weatherRelatedRoadConditionType is an
// array, animalPresenceType is a bare object, in different example files).
// Handles both instead of trusting one shape per field.
function firstValue(field: EnumValue | EnumValue[] | null | undefined): string | null {
  if (!field) return null
  const v = Array.isArray(field) ? field[0]?.value : field.value
  return v ?? null
}

interface RawSituationRecord {
  id: string
  probabilityOfOccurrence?: EnumValue | null
  locationReference?: {
    pointByCoordinates?: { pointCoordinates?: { latitude?: number; longitude?: number } | null } | null
  } | null
  weatherRelatedRoadConditionType?: EnumValue | EnumValue[] | null
  animalPresenceType?: EnumValue | EnumValue[] | null
  environmentalObstructionType?: EnumValue | EnumValue[] | null
  generalObstructionType?: EnumValue | EnumValue[] | null
  obstructionType?: EnumValue | EnumValue[] | null
  roadMaintenanceType?: EnumValue | EnumValue[] | null
  poorEnvironmentType?: EnumValue | EnumValue[] | null
  trafficConstrictionType?: EnumValue | EnumValue[] | null
}

interface RawSrtiResponse {
  situation?: { situationRecord?: RawSituationRecord[] | null }[] | null
}

export interface DatexHazard {
  id: string
  lat: number
  lng: number
  headerText: string
  severity: 'warning' | 'severe'
}

// Only CERTAIN/PROBABLE reach a rider — RISK_OF is Tark Tee's own term for
// "might happen," speculative enough that surfacing it as a current hazard
// would read more confident than it is, the same honesty bar the rest of
// this app's delay/disruption reporting holds to (see estimate.ts).
const SURFACED_PROBABILITIES = new Set(['CERTAIN', 'PROBABLE'])

export interface FeedConfig {
  path: string
  describe: (r: RawSituationRecord) => { header: string; severity: 'warning' | 'severe' } | null
}

const ANIMAL_LABELS: Record<string, string> = {
  ANIMALS_ON_THE_ROAD: 'Loomad teel',
  LARGE_ANIMALS_ON_THE_ROAD: 'Suured loomad teel',
}

const ROADWORKS_LABELS: Record<string, string> = {
  ROADWORKS: 'Lühiajalised teetööd',
  RESURFACING_WORK: 'Lühiajalised katendtööd',
  ROAD_MARKING_WORK: 'Teekattemärgistuse tööd',
}

const WEATHER_LABELS: Record<string, string> = {
  HEAVY_SNOWFALL: 'Tugev lumesadu',
  STRONG_WINDS: 'Tugev tuul',
  ICE_RAIN: 'Jäide',
}

// One entry per Tark Tee SRTI feed (https://tarktee.mnt.ee/#/et/datex,
// section "DATEX II 3.6 teenused"). Each feed only ever carries the
// sub-type field(s) documented for it, but a record failing to match any
// known value is dropped rather than guessed at.
export const FEEDS: FeedConfig[] = [
  {
    path: 'temporarySlipperyRoad',
    describe: (r) => (firstValue(r.weatherRelatedRoadConditionType) ? { header: 'Libe tee', severity: 'warning' } : null),
  },
  {
    path: 'animalObstacle',
    describe: (r) => {
      const animal = firstValue(r.animalPresenceType)
      if (animal) return ANIMAL_LABELS[animal] ? { header: ANIMAL_LABELS[animal], severity: 'warning' } : null
      if (firstValue(r.environmentalObstructionType) === 'FALLEN_TREES') {
        return { header: 'Puu langenud teele', severity: 'warning' }
      }
      if (firstValue(r.generalObstructionType) === 'OBJECT_ON_THE_ROAD') {
        return { header: 'Ese teel', severity: 'warning' }
      }
      return null
    },
  },
  {
    path: 'unprotectedAccident',
    describe: (r) =>
      firstValue(r.obstructionType) === 'UNPROTECTED_ACCIDENT_AREA'
        ? { header: 'Kaitsmata õnnetusala', severity: 'severe' }
        : null,
  },
  {
    path: 'shortTermRoadWorks',
    describe: (r) => {
      const type = firstValue(r.roadMaintenanceType)
      return type && ROADWORKS_LABELS[type] ? { header: ROADWORKS_LABELS[type], severity: 'warning' } : null
    },
  },
  {
    path: 'reducedVisibility',
    describe: (r) => (firstValue(r.poorEnvironmentType) === 'VISIBILITY_REDUCED' ? { header: 'Piiratud nähtavus', severity: 'warning' } : null),
  },
  {
    path: 'unmanagedBlockage',
    describe: (r) =>
      firstValue(r.trafficConstrictionType) === 'ROAD_BLOCKED' ? { header: 'Märgistamata takistus teel', severity: 'severe' } : null,
  },
  {
    path: 'exceptionalWeather',
    describe: (r) => {
      const type = firstValue(r.poorEnvironmentType)
      return type && WEATHER_LABELS[type] ? { header: WEATHER_LABELS[type], severity: 'warning' } : null
    },
  },
]

export function isDatexConfigured(): boolean {
  return Boolean(process.env.DATEX_API_KEY)
}

// Parses one feed's response into hazards. Separated from the fetch so the
// parsing rules — the part most likely to need correcting against a real
// hazard once one actually occurs — are testable without a network or key.
export function parseSrtiResponse(feed: FeedConfig, body: unknown): DatexHazard[] {
  const situations = (body as RawSrtiResponse)?.situation
  if (!Array.isArray(situations)) return []

  const hazards: DatexHazard[] = []
  for (const situation of situations) {
    for (const record of situation.situationRecord || []) {
      const probability = firstValue(record.probabilityOfOccurrence)
      if (!probability || !SURFACED_PROBABILITIES.has(probability)) continue

      const point = record.locationReference?.pointByCoordinates?.pointCoordinates
      if (typeof point?.latitude !== 'number' || typeof point?.longitude !== 'number') continue

      const described = feed.describe(record)
      if (!described) continue

      hazards.push({ id: record.id, lat: point.latitude, lng: point.longitude, headerText: described.header, severity: described.severity })
    }
  }
  return hazards
}

async function fetchFeed(feed: FeedConfig, key: string): Promise<DatexHazard[]> {
  try {
    const response = await fetch(`${DATEX_BASE_URL}/${feed.path}`, {
      headers: { 'X-DATEX-API-KEY': key },
      cache: 'no-store',
      signal: AbortSignal.timeout(GPS_FEED_TIMEOUT_MS),
    })
    if (!response.ok) return []
    return parseSrtiResponse(feed, await response.json())
  } catch {
    return []
  }
}

let cache: { data: DatexHazard[]; timestamp: number } | null = null

// Exported for tests — resets the polling cache between cases.
export function resetDatexCache(): void {
  cache = null
}

async function fetchAllHazards(): Promise<DatexHazard[]> {
  const key = process.env.DATEX_API_KEY
  if (!key) return []

  const now = Date.now()
  if (cache && now - cache.timestamp < DATEX_SRTI_CACHE_TTL) return cache.data

  // Independent per-feed requests, same as tarktee.ts's restrictions +
  // emergency_events: one feed erroring (or Tark Tee dropping a route
  // entirely) shouldn't cost the others their data for this cycle.
  const results = await Promise.all(FEEDS.map((feed) => fetchFeed(feed, key)))
  const data = results.flat()
  cache = { data, timestamp: now }
  return data
}

export async function getDatexHazardAlerts(): Promise<ServiceAlert[]> {
  if (!isDatexConfigured()) return []

  const [hazards, routeChunks] = await Promise.all([fetchAllHazards(), getMatchableRouteChunks()])
  if (hazards.length === 0 || routeChunks.length === 0) return []

  const alerts: ServiceAlert[] = []
  for (const hazard of hazards) {
    const affectedRoutes = findAffectedRoutes([[hazard.lng, hazard.lat]], routeChunks)
    if (affectedRoutes.length === 0) continue // nothing a rider would care about

    alerts.push({
      id: `datex-${hazard.id}`,
      headerText: hazard.headerText,
      descriptionText: '',
      severity: hazard.severity,
      affectedRoutes,
      lat: hazard.lat,
      lng: hazard.lng,
    })
  }
  return alerts
}
