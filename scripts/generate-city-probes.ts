/**
 * Regenerates src/lib/traffic/city-probes.json — the static "where do we ask
 * about traffic, and which city route does each answer speak for" reference
 * behind src/lib/traffic/city-estimate.ts.
 *
 * Why this exists: Tark Tee's own detectors (src/lib/traffic/index.ts) sit on
 * state highways. Measured against the top-15 cities, only 0-3 of the 112
 * sites are within 5km of any city centre, so a Tartu or Narva *city* bus
 * spends its whole trip on streets no detector watches — which is why
 * route-coverage.json covers 251 intercity coaches and no urban line. These
 * probe points are the city-street stand-in: a handful of coordinates per
 * city, each sitting on a stretch of road that several of that city's own bus
 * routes actually share, which TomTom's Traffic Flow API can be asked about
 * at runtime (current speed vs. that road's own free-flow speed).
 *
 * Deliberately generated, never hand-written, and re-runnable: route shapes
 * shift when the national GTFS feed is rebuilt (weekly, see
 * .github/workflows/build-otp-graph.yml), and a probe left sitting on a road
 * no route uses any more is a request spent on nothing.
 *
 * Run against a loaded OTP graph:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/generate-city-probes.ts
 *
 * Reads OTP_BASE_URL (default http://localhost:8080), writes the JSON, and
 * prints a per-city summary so a bad run is obvious before it's committed.
 */
import { writeFileSync } from 'fs'
import path from 'path'
import { CITIES, CityDef, OTP_BASE_URL } from '../src/lib/constants'
import { decodePolyline } from '../src/lib/decode-polyline'
import { distanceMeters, projectOntoSegment } from '../src/lib/delay'

// The cities this feature covers, by population — the same "top 15" the
// request is scoped to. Everything below the cut has too few urban routes of
// its own to be worth a request budget (several have no city network at all,
// just regional lines passing through).
const TOP_CITY_COUNT = 15

// A route belongs to a city when this much of it is inside that city's own
// radius — high enough that a regional line merely terminating at the bus
// station doesn't get counted as an urban route, low enough that a real city
// line reaching one stop past the boundary still does.
const URBAN_STOP_FRACTION = 0.75

// How far out a city's own network reaches. Scaled by population rather than
// fixed: Tallinn's own lines run to Pirita/Nõmme ~12km out, while a 7km
// radius around Valga would swallow half of Latvia's side of the border.
function urbanRadiusMeters(city: CityDef): number {
  if (city.population >= 200_000) return 15_000
  if (city.population >= 30_000) return 10_000
  return 8_000
}

// Spacing for walking each route's polyline. Fine enough that a probe grid
// cell is never skipped over on a fast straight stretch, coarse enough not to
// produce hundreds of thousands of points nationwide.
const SAMPLE_SPACING_M = 250
// Sampled points are bucketed into a grid this size and each bucket becomes
// one candidate probe — roughly a long city block, so two probes never end up
// describing the same junction.
const PROBE_GRID_M = 350
// The hard per-city cap. Each probe is one TomTom request per refresh (see
// CITY_FLOW_CACHE_TTL), so this is the knob that decides what the feature
// costs: 15 cities x 10 = 150 requests to refresh the whole country once.
const MAX_PROBES_PER_CITY = 10
// A probe speaks for a route only if it's this close to that route's own
// path — the same 300m bar route-coverage.json's generation used for
// detector-to-route matching.
const PROBE_ROUTE_MATCH_M = 300
// Ranking cells purely by how many routes share them puts every probe in the
// city centre, where all the lines overlap — the first run of this script
// gave Tallinn ten probes inside a 2km circle, which measures one junction
// ten times and says nothing about the outer two-thirds of any route. Probes
// are picked greedily by route count but must sit at least this far apart, as
// a fraction of the city's own radius, so the budget buys distinct corridors.
const PROBE_SEPARATION_FRACTION = 1 / 6
// One probe can't represent a whole city line on its own; a route needs at
// least this many before it's worth querying OTP for its schedule at all.
// The runtime coverage gate (MIN_COVERED_FRACTION) is the real quality bar —
// this just avoids spending a request on a route that could never clear it.
const MIN_PROBES_PER_ROUTE = 2

interface GqlStop {
  lat: number
  lon: number
}

interface RouteWithStops {
  gtfsId: string
  shortName: string
  longName: string
  mode: string
  patterns: { stops: GqlStop[] }[]
}

interface ProbeOut {
  id: string
  lat: number
  lon: number
  // How many of the city's own routes share this stretch of road. Not used at
  // runtime — it's why this probe was picked over the ones that didn't make
  // MAX_PROBES_PER_CITY, so a regenerated file can be diffed meaningfully.
  routeCount: number
}

interface CityRouteOut {
  routeGtfsId: string
  shortName: string
  longName: string
  probeIds: string[]
}

interface CityProbesOut {
  cityId: string
  probes: ProbeOut[]
  routes: CityRouteOut[]
}

async function otpQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!response.ok) throw new Error(`OTP returned ${response.status}`)
  const data = await response.json()
  if (data.errors?.length) throw new Error(`OTP errors: ${JSON.stringify(data.errors).slice(0, 400)}`)
  return data.data as T
}

// Walk a decoded polyline, emitting a point every SAMPLE_SPACING_M. Straight
// segments longer than the spacing get interpolated points rather than only
// their endpoints, so a long arterial isn't represented by its ends alone.
function samplePath(points: [number, number][]): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = []
  if (points.length === 0) return out
  let carry = 0
  out.push({ lat: points[0][1], lon: points[0][0] })
  for (let i = 0; i < points.length - 1; i++) {
    const [fromLon, fromLat] = points[i]
    const [toLon, toLat] = points[i + 1]
    const segLen = distanceMeters(fromLat, fromLon, toLat, toLon)
    if (segLen === 0) continue
    let travelled = SAMPLE_SPACING_M - carry
    while (travelled <= segLen) {
      const f = travelled / segLen
      out.push({ lat: fromLat + (toLat - fromLat) * f, lon: fromLon + (toLon - fromLon) * f })
      travelled += SAMPLE_SPACING_M
    }
    carry = (carry + segLen) % SAMPLE_SPACING_M
  }
  return out
}

// Metres-per-degree at Estonian latitudes, used only to size the probe grid —
// exact enough for bucketing, and keeps this from pulling in a projection.
const M_PER_DEG_LAT = 111_320
function mPerDegLon(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
}

async function main() {
  const cities = [...CITIES].sort((a, b) => b.population - a.population).slice(0, TOP_CITY_COUNT)
  console.log(`Cities: ${cities.map((c) => c.name).join(', ')}\n`)

  console.log('Fetching all bus/tram routes with their stops...')
  const { routes } = await otpQuery<{ routes: RouteWithStops[] }>(
    '{ routes(transportModes:[BUS,TRAM]) { gtfsId shortName longName mode patterns { stops { lat lon } } } }',
  )
  console.log(`  ${routes.length} routes\n`)

  // Assign each route to at most one city — the one it sits most squarely
  // inside. Without this, Maardu (which Tallinn's own lines serve) would
  // claim a share of Tallinn's network and spend its probe budget
  // re-measuring roads Tallinn already covers.
  const routeCity = new Map<string, { city: CityDef; fraction: number }>()
  for (const route of routes) {
    const stops = route.patterns.flatMap((p) => p.stops)
    if (stops.length < 2) continue
    for (const city of cities) {
      const radius = urbanRadiusMeters(city)
      const inside = stops.filter((s) => distanceMeters(s.lat, s.lon, city.lat, city.lng) <= radius).length
      const fraction = inside / stops.length
      if (fraction < URBAN_STOP_FRACTION) continue
      const current = routeCity.get(route.gtfsId)
      if (!current || fraction > current.fraction) routeCity.set(route.gtfsId, { city, fraction })
    }
  }

  const byCity = new Map<string, RouteWithStops[]>()
  for (const route of routes) {
    const assignment = routeCity.get(route.gtfsId)
    if (!assignment) continue
    const list = byCity.get(assignment.city.id) || []
    list.push(route)
    byCity.set(assignment.city.id, list)
  }

  const selected = [...byCity.values()].flat()
  console.log(`Fetching pattern geometry for ${selected.length} urban routes...`)
  // Batched the same way buildRoutesByIdQuery batches — one aliased request
  // per chunk rather than one request per route.
  const geometryByRoute = new Map<string, [number, number][][]>()
  const CHUNK = 60
  for (let i = 0; i < selected.length; i += CHUNK) {
    const chunk = selected.slice(i, i + CHUNK)
    const fields = chunk
      .map((r, j) => `r${j}: route(id: ${JSON.stringify(r.gtfsId)}) { patterns { patternGeometry { points } } }`)
      .join('\n')
    const data = await otpQuery<Record<string, { patterns: { patternGeometry?: { points: string } | null }[] } | null>>(
      `{ ${fields} }`,
    )
    chunk.forEach((route, j) => {
      const result = data[`r${j}`]
      if (!result) return
      const shapes = result.patterns
        .map((p) => (p.patternGeometry?.points ? decodePolyline(p.patternGeometry.points) : []))
        .filter((s) => s.length > 1)
      if (shapes.length > 0) geometryByRoute.set(route.gtfsId, shapes)
    })
    process.stdout.write(`  ${Math.min(i + CHUNK, selected.length)}/${selected.length}\r`)
  }
  console.log(`\n  geometry for ${geometryByRoute.size} routes\n`)

  const output: CityProbesOut[] = []
  for (const city of cities) {
    const cityRoutes = (byCity.get(city.id) || []).filter((r) => geometryByRoute.has(r.gtfsId))
    if (cityRoutes.length === 0) {
      console.log(`${city.name.padEnd(14)} no urban routes with geometry — skipped`)
      continue
    }

    // Bucket every sampled point of every route into a grid cell, tracking
    // which routes touched each cell. Cells shared by the most routes are the
    // city's real shared corridors — the best value per request.
    const cells = new Map<string, { routes: Set<string>; points: { lat: number; lon: number }[] }>()
    const routeSamples = new Map<string, { lat: number; lon: number }[]>()
    for (const route of cityRoutes) {
      const samples = (geometryByRoute.get(route.gtfsId) || []).flatMap(samplePath)
      routeSamples.set(route.gtfsId, samples)
      for (const point of samples) {
        // Only points inside the city itself — a city line's tail out to a
        // park-and-ride is not where its riders sit in traffic.
        if (distanceMeters(point.lat, point.lon, city.lat, city.lng) > urbanRadiusMeters(city)) continue
        const key = `${Math.round((point.lat * M_PER_DEG_LAT) / PROBE_GRID_M)}:${Math.round(
          (point.lon * mPerDegLon(point.lat)) / PROBE_GRID_M,
        )}`
        const cell = cells.get(key) || { routes: new Set<string>(), points: [] }
        cell.routes.add(route.gtfsId)
        cell.points.push(point)
        cells.set(key, cell)
      }
    }

    const ranked = [...cells.values()].sort(
      (a, b) => b.routes.size - a.routes.size || b.points.length - a.points.length,
    )

    // The probe must land on a road TomTom can snap to, so each cell is
    // represented by a real sampled point (the one nearest its centroid)
    // rather than the centroid itself, which can fall in the middle of a
    // block.
    const separation = urbanRadiusMeters(city) * PROBE_SEPARATION_FRACTION
    const probes: ProbeOut[] = []
    for (const cell of ranked) {
      if (probes.length >= MAX_PROBES_PER_CITY) break
      const avgLat = cell.points.reduce((s, p) => s + p.lat, 0) / cell.points.length
      const avgLon = cell.points.reduce((s, p) => s + p.lon, 0) / cell.points.length
      const nearest = cell.points.reduce((best, p) =>
        distanceMeters(p.lat, p.lon, avgLat, avgLon) < distanceMeters(best.lat, best.lon, avgLat, avgLon) ? p : best,
      )
      if (probes.some((p) => distanceMeters(p.lat, p.lon, nearest.lat, nearest.lon) < separation)) continue
      probes.push({
        id: `${city.id}-${probes.length + 1}`,
        lat: Number(nearest.lat.toFixed(6)),
        lon: Number(nearest.lon.toFixed(6)),
        routeCount: cell.routes.size,
      })
    }

    // Which probes each route actually passes — measured against the route's
    // own polyline segments, not just its sampled points, so a probe beside a
    // long straight stretch still counts.
    const cityRouteOut: CityRouteOut[] = []
    for (const route of cityRoutes) {
      const shapes = geometryByRoute.get(route.gtfsId) || []
      const probeIds = probes
        .filter((probe) => {
          for (const shape of shapes) {
            for (let i = 0; i < shape.length - 1; i++) {
              const { dist } = projectOntoSegment(
                probe.lat,
                probe.lon,
                shape[i][1],
                shape[i][0],
                shape[i + 1][1],
                shape[i + 1][0],
              )
              if (dist <= PROBE_ROUTE_MATCH_M) return true
            }
          }
          return false
        })
        .map((p) => p.id)
      if (probeIds.length < MIN_PROBES_PER_ROUTE) continue
      cityRouteOut.push({
        routeGtfsId: route.gtfsId,
        shortName: route.shortName,
        longName: route.longName,
        probeIds,
      })
    }

    console.log(
      `${city.name.padEnd(14)} ${String(probes.length).padStart(2)} probes, ` +
        `${String(cityRouteOut.length).padStart(3)}/${cityRoutes.length} routes covered`,
    )
    if (cityRouteOut.length === 0) continue
    output.push({ cityId: city.id, probes, routes: cityRouteOut })
  }

  const target = path.join(__dirname, '..', 'src', 'lib', 'traffic', 'city-probes.json')
  writeFileSync(target, JSON.stringify(output, null, 2) + '\n')
  const probeTotal = output.reduce((sum, c) => sum + c.probes.length, 0)
  const routeTotal = output.reduce((sum, c) => sum + c.routes.length, 0)
  console.log(`\nWrote ${target}`)
  console.log(`${output.length} cities, ${probeTotal} probes, ${routeTotal} routes`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
