import { decodePolyline } from '../decode-polyline'

describe('decodePolyline', () => {
  it('decodes the canonical Google Maps reference polyline, including negative deltas', () => {
    // From Google's own encoded polyline algorithm documentation:
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    // (lat, lng) points: (38.5, -120.2), (40.7, -120.95), (43.252, -126.453)
    const coords = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')

    expect(coords).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ])
  })

  it('returns an empty array for an empty string', () => {
    expect(decodePolyline('')).toEqual([])
  })
})
