import cityProbesData from './city-probes.json'

// Static reference data for city-street traffic estimates: a handful of
// coordinates per city, each on a stretch of road several of that city's own
// bus routes share, plus which routes each one speaks for.
//
// Generated, not hand-written — see scripts/generate-city-probes.ts for how
// (urban routes picked by what fraction of their stops sit inside the city,
// route polylines sampled every 250m, sampled points bucketed onto a 350m
// grid, cells ranked by how many routes share them, then greedily picked
// with a minimum separation so the probes cover distinct corridors instead
// of ten adjacent blocks in the centre). Regenerate after a graph rebuild.
//
// This is the city-street counterpart to ./index.ts's detector sites, and is
// scoped the same way: static only. It says where to ask about traffic and
// who the answer applies to, never what any road currently reads — that's
// ./tomtom.ts.
//
// Maardu is deliberately absent despite being in the top 15 by population:
// it has no bus network of its own (Tallinn's lines serve it), so every
// route near it is already covered as a Tallinn route, and the UI's own
// 30km city-relevance radius surfaces those for a Maardu rider anyway.

export interface CityProbe {
  id: string
  lat: number
  lon: number
  // How many of the city's routes share this stretch of road — why this
  // probe was picked. Not used at runtime; see the generator.
  routeCount: number
}

export interface CityProbeRoute {
  routeGtfsId: string
  shortName: string
  longName: string
  probeIds: string[]
}

export interface CityProbeSet {
  cityId: string
  probes: CityProbe[]
  routes: CityProbeRoute[]
}

export const CITY_PROBE_SETS: CityProbeSet[] = cityProbesData

const byCityId = new Map(CITY_PROBE_SETS.map((c) => [c.cityId, c]))
const probeById = new Map(CITY_PROBE_SETS.flatMap((c) => c.probes.map((p) => [p.id, p] as const)))

export function getCityProbeSet(cityId: string): CityProbeSet | undefined {
  return byCityId.get(cityId)
}

export function getProbe(probeId: string): CityProbe | undefined {
  return probeById.get(probeId)
}
