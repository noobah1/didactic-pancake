import detectorSitesData from './detector-sites.json'
import routeCoverageData from './route-coverage.json'

// Static reference data: where Transpordiamet's state-highway traffic
// detectors physically are, and which of Estonia's intercity coach routes
// travel close enough to them to get meaningful coverage from their readings.
//
// Both are generated, not hand-written. Detector locations came from
// Transpordiamet's public ArcGIS catalog (tarktee.transpordiamet.ee) —
// published in EPSG:3301 (Estonian National Grid) and converted to WGS84
// here. Route coverage was computed by projecting each route's GTFS pattern
// geometry against every detector site and keeping routes with 3+ detectors
// within 300m of their path — enough for a real trend along the route, not
// just a single lucky highway crossing. Regenerate both by re-running the
// same OTP `routes(transportModes: [BUS])` query and re-projecting; neither
// changes often (detector sites and route shapes are both stable for months
// at a time).
//
// This module is intentionally scoped to STATIC data only — it says where
// detectors are and which routes are near them, not what any detector
// currently reads. Live readings require a Tark Tee DATEX II API key
// (registration: https://tarktee.mnt.ee/#/et/datex) and come as DATEX II XML,
// not the JSON shape used here. Once that key exists, the missing piece is:
// fetch the live MeasuredDataPublication, parse each detector's
// relativeSpeed/averageSpeed by traffic_detector_id (matching DetectorSite.id
// below), then for each RouteCoverage whose nearest detectors show reduced
// relative speed, surface an ESTIMATED (not confirmed) delay for that route —
// visually distinct from Tallinn's GPS-confirmed delays, same honesty
// principle used everywhere else delay is shown in this app.

export interface DetectorSite {
  id: string
  name: string
  road: string
  lat: number
  lon: number
}

export interface RouteDetector {
  detectorId: string
  distanceMeters: number
}

export interface RouteCoverage {
  routeGtfsId: string
  shortName: string
  longName: string
  detectors: RouteDetector[]
}

export const DETECTOR_SITES: DetectorSite[] = detectorSitesData
export const ROUTE_COVERAGE: RouteCoverage[] = routeCoverageData

const detectorById = new Map(DETECTOR_SITES.map((d) => [d.id, d]))
const coverageByGtfsId = new Map(ROUTE_COVERAGE.map((r) => [r.routeGtfsId, r]))

export function getDetectorSite(detectorId: string): DetectorSite | undefined {
  return detectorById.get(detectorId)
}

// Does this route have real traffic-estimate coverage (3+ nearby detectors)?
export function getRouteCoverage(routeGtfsId: string): RouteCoverage | undefined {
  return coverageByGtfsId.get(routeGtfsId)
}
