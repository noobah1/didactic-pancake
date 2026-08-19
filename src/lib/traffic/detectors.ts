import { TARKTEE_DETECTORS_SERVICE, DETECTOR_CACHE_TTL } from '../constants'
import { queryArcGisLayer } from './arcgis'

export type Direction = 'forwards' | 'backwards'

export interface DirectionReading {
  avgSpeedKmh: number
  // Tark Tee's own coarse coded congestion level — observed values 1 and 2
  // in live samples (1 reads as free-flow). Used only for baseline.ts's
  // cold-start bootstrap, never for the excess-time math itself (see
  // estimate.ts) — average_speed is the actual measurement, this is a hint.
  relativeSpeed: number | null
  flow: number | null
}

export interface DetectorReading {
  detectorId: string
  measuredAt: number // ms epoch
  forwards: DirectionReading | null
  backwards: DirectionReading | null
}

interface RawAttrs {
  traffic_detector_id: string | null
  measurement_time: number | null
  average_speed_forwards: number | null
  average_speed_backwards: number | null
  relative_speed_forwards: number | null
  relative_speed_backwards: number | null
  total_flow_forwards: number | null
  total_flow_backwards: number | null
}

let cache: { data: Map<string, DetectorReading>; timestamp: number } | null = null

// Live speed/flow readings for every Tark Tee traffic detector — confirmed
// live: 116 records, ~2 minutes old at fetch time, 111 of the 112 detector
// ids in detector-sites.json present. A direction with a null average speed
// (confirmed live, e.g. site "Loo") is dropped rather than kept as a
// half-populated reading — nothing downstream should have to re-check for
// null speed on every use.
export async function fetchDetectorReadings(): Promise<Map<string, DetectorReading>> {
  const now = Date.now()
  if (cache && now - cache.timestamp < DETECTOR_CACHE_TTL) {
    return cache.data
  }
  try {
    const features = await queryArcGisLayer<RawAttrs>(TARKTEE_DETECTORS_SERVICE, 0, {
      outFields: [
        'traffic_detector_id',
        'measurement_time',
        'average_speed_forwards',
        'average_speed_backwards',
        'relative_speed_forwards',
        'relative_speed_backwards',
        'total_flow_forwards',
        'total_flow_backwards',
      ],
      returnGeometry: false,
    })

    const readings = new Map<string, DetectorReading>()
    for (const f of features) {
      const a = f.attributes
      if (!a.traffic_detector_id || !a.measurement_time) continue

      const forwards: DirectionReading | null =
        a.average_speed_forwards != null
          ? { avgSpeedKmh: a.average_speed_forwards, relativeSpeed: a.relative_speed_forwards, flow: a.total_flow_forwards }
          : null
      const backwards: DirectionReading | null =
        a.average_speed_backwards != null
          ? { avgSpeedKmh: a.average_speed_backwards, relativeSpeed: a.relative_speed_backwards, flow: a.total_flow_backwards }
          : null
      if (!forwards && !backwards) continue

      readings.set(a.traffic_detector_id, {
        detectorId: a.traffic_detector_id,
        measuredAt: a.measurement_time,
        forwards,
        backwards,
      })
    }

    cache = { data: readings, timestamp: now }
    return readings
  } catch {
    // Someone else's public infra — never let it take the delay board down;
    // fall back to the last good sample (or empty on first failure), same
    // convention as tarktee.ts and elron.ts.
    return cache?.data || new Map()
  }
}
