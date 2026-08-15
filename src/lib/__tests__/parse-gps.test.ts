import { parseGpsFeed } from '../parse-gps'

describe('parseGpsFeed', () => {
  it('parses a valid gps.txt line into VehiclePosition', () => {
    const raw = '3,2,24711780,59448550,,142,96,Z,147,Suur-Paala'
    const result = parseGpsFeed(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: '96',
      mode: 'tram',
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
      '2,15,24745970,59433380,,14,1009,Z,7,Tondi',
    ].join('\n')
    const result = parseGpsFeed(raw)
    expect(result).toHaveLength(2)
    expect(result[0].mode).toBe('tram')
    expect(result[1].mode).toBe('bus')
  })

  it('parses type code 1 as trolleybus', () => {
    const raw = '1,4,24776270,59428570,,309,505,Z,188,Tondi'
    const result = parseGpsFeed(raw)
    expect(result).toHaveLength(1)
    expect(result[0].mode).toBe('trolleybus')
  })

  it('parses type code 7 as nightbus', () => {
    const raw = '7,40,24776270,59428570,,309,505,Z,188,Tondi'
    const result = parseGpsFeed(raw)
    expect(result).toHaveLength(1)
    expect(result[0].mode).toBe('nightbus')
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
