import { VehiclePosition } from './types'
import { GPS_TYPE_MAP } from './constants'

export function parseGpsFeed(raw: string): VehiclePosition[] {
  if (!raw.trim()) return []

  return raw
    .trim()
    .split('\n')
    .map((line) => {
      const parts = line.split(',')
      if (parts.length < 10) return null

      const [typeCode, lineNum, lngRaw, latRaw, , headingRaw, vehicleId, , , destination] = parts
      const mode = GPS_TYPE_MAP[typeCode]
      if (!mode) return null

      const lng = parseInt(lngRaw, 10) / 1e6
      const lat = parseInt(latRaw, 10) / 1e6
      if (isNaN(lng) || isNaN(lat)) return null

      return {
        id: vehicleId,
        mode,
        line: lineNum,
        lat,
        lng,
        heading: parseInt(headingRaw, 10) || 0,
        destination,
      } satisfies VehiclePosition
    })
    .filter((v): v is VehiclePosition => v !== null)
}
