import { parseGpsFeed } from '../parse-gps'

describe('parseGpsFeed', () => {
  it('parses a valid gps.txt line into VehiclePosition', () => {
    const raw = '3,2,24711780,59448550,,142,96,Z,147,Suur-Paala'
    const result = parseGpsFeed(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: '96',
      mode: 'bus',
      line: '2',
      lat: 59.44855,
      lng: 24.71178,
      heading: 142,
      destination: 'Suur-Paala',
    })
  })

  it('parses multiple lines', () => {
    const raw = [
      '3,2,24711780,59448550,,142,96,Z,147,Suur-Paala',
      '1,4,24745970,59433380,,14,1009,Z,7,Tondi',
    ].join('\n')
    const result = parseGpsFeed(raw)
    expect(result).toHaveLength(2)
    expect(result[0].mode).toBe('bus')
    expect(result[1].mode).toBe('tram')
  })

  it('skips malformed lines', () => {
    const raw = 'bad,data\n3,2,24711780,59448550,,142,96,Z,147,Suur-Paala'
    const result = parseGpsFeed(raw)
    expect(result).toHaveLength(1)
  })

  it('returns empty array for empty input', () => {
    expect(parseGpsFeed('')).toEqual([])
  })
})
