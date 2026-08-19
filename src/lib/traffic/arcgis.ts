import { GPS_FEED_TIMEOUT_MS } from '../constants'

// Shared client for Tark Tee's (tarktee.ee, Transpordiamet/Maanteeamet) ArcGIS
// REST API — a public, unauthenticated endpoint their own map page queries.
// Extracted from src/lib/tarktee.ts's original private queryArcGisLayer so
// src/lib/traffic/detectors.ts can hit a different layer (traffic_detectors,
// not tram/restrictions_traffic) without duplicating the fetch/timeout/error
// handling. tarktee.ts's own behavior is unchanged — see its call site.
export const TARKTEE_BASE_URL = 'https://www.tarktee.ee/tarktee/rest/services/tram'

export interface ArcGisFeature<A = Record<string, string | number | null>> {
  attributes: A
  geometry?: { paths?: [number, number][][] }
}

interface ArcGisResponse<A> {
  features?: ArcGisFeature<A>[]
}

export interface QueryArcGisLayerParams {
  outFields: string[]
  where?: string
  returnGeometry?: boolean
}

export async function queryArcGisLayer<A = Record<string, string | number | null>>(
  service: string,
  layerId: number,
  params: QueryArcGisLayerParams,
): Promise<ArcGisFeature<A>[]> {
  const query = new URLSearchParams({
    f: 'json',
    outFields: params.outFields.join(','),
    outSR: '4326',
    returnGeometry: String(params.returnGeometry ?? true),
    where: params.where ?? '1=1',
  })
  const response = await fetch(`${TARKTEE_BASE_URL}/${service}/MapServer/${layerId}/query?${query}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(GPS_FEED_TIMEOUT_MS),
  })
  if (!response.ok) return []
  const data: ArcGisResponse<A> = await response.json()
  return data.features || []
}
