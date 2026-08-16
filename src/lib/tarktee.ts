// Estonia's official live road-traffic system (tarktee.ee, run by
// Transpordiamet/Maanteeamet — the same agency behind the national GTFS
// data). Its own map page queries a public, unauthenticated ArcGIS REST API
// — confirmed live, no API key anywhere. Used here to flag regional
// bus/ferry routes currently affected by a real closure or accident, since
// those fleets have no live GPS anywhere to compute an actual delay from
// (see the delay board's own Elron/Tallinn-only coverage). This can only
// ever produce a qualitative "this route has a known disruption right now"
// flag — Tark Tee has no speed/congestion data, so never treat it as a
// numeric delay.
import { OTP_BASE_URL, TALLINN_TRANSPORT_AGENCY_GTFS_ID } from './constants'
import { decodePolyline } from './decode-polyline'
import { projectOntoSegment } from './delay'
import { ServiceAlert } from './types'

const TARKTEE_BASE_URL = 'https://www.tarktee.ee/tarktee/rest/services/tram'
// Roadworks/closures don't change second to second — this is someone else's
// public infra, not ours, so poll it gently (same spirit as
// ELRON_GPS_CACHE_TTL's comment on the Elron feed).
const DISRUPTIONS_CACHE_TTL = 5 * 60_000
// Route shapes are static within a service day — cache far longer than the
// disruptions themselves.
const ROUTE_SHAPES_CACHE_TTL = 30 * 60_000
// Both sides of this match are precise road-centerline geometry (not noisy
// vehicle GPS like the rest of this app's matching), so a tight radius is
// enough to be confident a route actually runs the affected road.
const MATCH_RADIUS_M = 100

interface Disruption {
  objectId: number
  roadName: string
  cause: string
  description: string
  severity: ServiceAlert['severity']
  dateFrom?: number
  dateTo?: number
  points: [number, number][] // [lng, lat], matches decodePolyline's convention
}

interface RouteShape {
  line: string
  points: [number, number][] // [lng, lat]
}

interface ArcGisFeature {
  attributes: Record<string, string | number | null>
  geometry?: { paths?: [number, number][][] }
}

interface ArcGisResponse {
  features?: ArcGisFeature[]
}

function activeNowWhereClause(): string {
  // Matches the filter tarktee.ee's own frontend applies, minus its ~8-day
  // upcoming-inclusive window — we only want disruptions affecting service
  // right now. Precision to the hour isn't meaningful here (restriction date
  // ranges are date-level, not minute-level), so a UTC timestamp is close
  // enough despite Estonia running UTC+2/+3.
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  return `(date_from is null or date_from <= '${now}') and (date_to is null or date_to >= '${now}')`
}

async function queryArcGisLayer(
  layer: string,
  outFields: string[],
): Promise<ArcGisFeature[]> {
  const params = new URLSearchParams({
    f: 'json',
    outFields: outFields.join(','),
    outSR: '4326',
    returnGeometry: 'true',
    where: activeNowWhereClause(),
  })
  const response = await fetch(`${TARKTEE_BASE_URL}/${layer}/MapServer/1/query?${params}`, {
    cache: 'no-store',
  })
  if (!response.ok) return []
  const data: ArcGisResponse = await response.json()
  return data.features || []
}

function humanize(code: string): string {
  return code.toLowerCase().replace(/_/g, ' ')
}

let disruptionsCache: { data: Disruption[]; timestamp: number } | null = null

async function fetchActiveDisruptions(): Promise<Disruption[]> {
  const now = Date.now()
  if (disruptionsCache && now - disruptionsCache.timestamp < DISRUPTIONS_CACHE_TTL) {
    return disruptionsCache.data
  }
  try {
    const [restrictions, emergencies] = await Promise.all([
      queryArcGisLayer('restrictions_traffic', [
        'objectid', 'road_name', 'cause', 'effect', 'extra_info', 'date_from', 'date_to',
      ]),
      queryArcGisLayer('emergency_events', [
        'objectid', 'road_name', 'primary_cause', 'extra_info', 'date_from', 'date_to',
      ]),
    ])

    const disruptions: Disruption[] = []
    for (const f of restrictions) {
      const points = f.geometry?.paths?.[0]
      if (!points || points.length === 0) continue
      const cause = String(f.attributes.cause || 'restriction')
      disruptions.push({
        objectId: Number(f.attributes.objectid),
        roadName: String(f.attributes.road_name || 'Unknown road'),
        cause: humanize(cause),
        description: String(f.attributes.extra_info || ''),
        severity: f.attributes.effect === 'COMPLETE_CLOSURE' ? 'severe' : 'warning',
        dateFrom: f.attributes.date_from ? Number(f.attributes.date_from) : undefined,
        dateTo: f.attributes.date_to ? Number(f.attributes.date_to) : undefined,
        points,
      })
    }
    for (const f of emergencies) {
      const points = f.geometry?.paths?.[0]
      if (!points || points.length === 0) continue
      disruptions.push({
        objectId: Number(f.attributes.objectid) + 1_000_000, // separate id space from restrictions
        roadName: String(f.attributes.road_name || 'Unknown road'),
        cause: humanize(String(f.attributes.primary_cause || 'incident')),
        description: String(f.attributes.extra_info || ''),
        severity: 'severe', // an active accident is always disruptive, unlike a routine restriction
        dateFrom: f.attributes.date_from ? Number(f.attributes.date_from) : undefined,
        dateTo: f.attributes.date_to ? Number(f.attributes.date_to) : undefined,
        points,
      })
    }

    disruptionsCache = { data: disruptions, timestamp: now }
    return disruptions
  } catch {
    return disruptionsCache?.data || []
  }
}

const ROUTE_SHAPES_QUERY = `
{
  bus: routes(transportModes: [BUS]) {
    shortName
    agency { gtfsId }
    patterns { patternGeometry { points } }
  }
  ferry: routes(transportModes: [FERRY]) {
    shortName
    patterns { patternGeometry { points } }
  }
}
`

interface GqlPattern {
  patternGeometry?: { points: string } | null
}
interface GqlRoute {
  shortName: string
  agency?: { gtfsId: string } | null
  patterns: GqlPattern[]
}

let routeShapesCache: { data: RouteShape[]; timestamp: number } | null = null

// Every BUS route outside Tallinn's own agency (already covered by real GPS
// — see TALLINN_TRANSPORT_AGENCY_GTFS_ID) plus every FERRY route (TS Laevad,
// also uncovered) — exactly the gap this feature exists to fill.
async function fetchCandidateRouteShapes(): Promise<RouteShape[]> {
  const now = Date.now()
  if (routeShapesCache && now - routeShapesCache.timestamp < ROUTE_SHAPES_CACHE_TTL) {
    return routeShapesCache.data
  }
  try {
    const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: ROUTE_SHAPES_QUERY }),
      cache: 'no-store',
    })
    if (!response.ok) return routeShapesCache?.data || []
    const data = await response.json()
    if (data.errors?.length) return routeShapesCache?.data || []

    const busRoutes: GqlRoute[] = (data.data?.bus || []).filter(
      (r: GqlRoute) => r.agency?.gtfsId !== TALLINN_TRANSPORT_AGENCY_GTFS_ID,
    )
    const ferryRoutes: GqlRoute[] = data.data?.ferry || []

    const shapes: RouteShape[] = []
    for (const route of [...busRoutes, ...ferryRoutes]) {
      const points: [number, number][] = []
      for (const pattern of route.patterns) {
        if (pattern.patternGeometry?.points) {
          points.push(...decodePolyline(pattern.patternGeometry.points))
        }
      }
      if (points.length > 0) shapes.push({ line: route.shortName, points })
    }

    routeShapesCache = { data: shapes, timestamp: now }
    return shapes
  } catch {
    return routeShapesCache?.data || []
  }
}

function bbox(points: [number, number][]): { minLng: number; maxLng: number; minLat: number; maxLat: number } {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return { minLng, maxLng, minLat, maxLat }
}

// Rough degrees-per-meter padding for the bbox prefilter — doesn't need to
// be precise, only wide enough to never reject a pair the precise check
// would have accepted.
const BBOX_PAD_DEG = (MATCH_RADIUS_M / 111_000) * 2

function bboxesOverlap(
  a: ReturnType<typeof bbox>,
  b: ReturnType<typeof bbox>,
): boolean {
  return (
    a.minLng - BBOX_PAD_DEG <= b.maxLng &&
    a.maxLng + BBOX_PAD_DEG >= b.minLng &&
    a.minLat - BBOX_PAD_DEG <= b.maxLat &&
    a.maxLat + BBOX_PAD_DEG >= b.minLat
  )
}

// Minimum distance from any point of `points` to the nearest segment of `shape`.
function minDistanceToShape(points: [number, number][], shape: [number, number][]): number {
  let best = Infinity
  for (const [lng, lat] of points) {
    for (let i = 0; i < shape.length - 1; i++) {
      const [aLng, aLat] = shape[i]
      const [bLng, bLat] = shape[i + 1]
      const { dist } = projectOntoSegment(lat, lng, aLat, aLng, bLat, bLng)
      if (dist < best) best = dist
      if (best < MATCH_RADIUS_M) return best // good enough, stop early
    }
  }
  return best
}

interface RouteChunk {
  line: string
  points: [number, number][]
  bbox: ReturnType<typeof bbox>
}

// Nationwide route shapes add up to millions of points combined (a single
// long intercity route alone can carry 10,000+), and a whole-route bounding
// box is a poor prefilter for a long, thin, winding line — its bbox covers a
// huge area almost any disruption bbox overlaps, defeating the prefilter for
// exactly the routes with the most points to scan. Confirmed live: matching
// against whole-route bboxes over the real nationwide data (2.2M points,
// 266 active disruptions) never finished in a reasonable time. Chunking each
// route into short windows with their own tight local bbox turns the
// prefilter back into an actual filter — a disruption only pays the real
// per-point distance check against the handful of chunks physically near it,
// not every chunk of every route in the country.
const CHUNK_SIZE = 20

function chunkRouteShapes(shapes: RouteShape[]): RouteChunk[] {
  const chunks: RouteChunk[] = []
  for (const route of shapes) {
    // Overlap consecutive chunks by one point so the segment spanning a
    // chunk boundary is never skipped.
    for (let i = 0; i < route.points.length - 1; i += CHUNK_SIZE) {
      const slice = route.points.slice(i, i + CHUNK_SIZE + 1)
      if (slice.length < 2) continue
      chunks.push({ line: route.line, points: slice, bbox: bbox(slice) })
    }
  }
  return chunks
}

export async function getRoadDisruptionAlerts(): Promise<ServiceAlert[]> {
  const [allDisruptions, routeShapes] = await Promise.all([
    fetchActiveDisruptions(),
    fetchCandidateRouteShapes(),
  ])
  // Tark Tee runs hundreds of minor restrictions (speed limits, single-lane
  // work zones) at any given moment nationwide — real, but far more volume
  // than a rider-facing "current issues" list is for. Full closures and
  // active accidents are the ones that actually disrupt a trip; keep only
  // those (confirmed live: this cuts ~266 active records down to ~24).
  const disruptions = allDisruptions.filter((d) => d.severity === 'severe')
  if (disruptions.length === 0 || routeShapes.length === 0) return []

  const routeChunks = chunkRouteShapes(routeShapes)

  const alerts: ServiceAlert[] = []
  for (const d of disruptions) {
    const dBbox = bbox(d.points)
    const affectedRoutes = new Set<string>()
    for (const chunk of routeChunks) {
      if (affectedRoutes.has(chunk.line)) continue // already confirmed for this disruption
      if (!bboxesOverlap(dBbox, chunk.bbox)) continue
      if (minDistanceToShape(d.points, chunk.points) < MATCH_RADIUS_M) {
        affectedRoutes.add(chunk.line)
      }
    }
    if (affectedRoutes.size === 0) continue // nothing a rider would care about

    alerts.push({
      id: `tarktee-${d.objectId}`,
      headerText: `${d.roadName}: ${d.cause}`,
      descriptionText: d.description,
      severity: d.severity,
      affectedRoutes: [...affectedRoutes],
      activePeriodStart: d.dateFrom ? new Date(d.dateFrom).toISOString() : undefined,
      activePeriodEnd: d.dateTo ? new Date(d.dateTo).toISOString() : undefined,
    })
  }
  return alerts
}
