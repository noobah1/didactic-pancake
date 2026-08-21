import { buildIndex, resolvePlatform, fetchStationPlatformIndex, ElronBoardRow } from '../elron-platform'

function row(overrides: Partial<ElronBoardRow> = {}): ElronBoardRow {
  return {
    plaaniline_aeg: '13:47',
    liin: 'Tallinn - Tartu',
    sihtjaam: 'Tartu',
    peatuskoht: '4',
    peatuskoht_muutunud: 'f',
    reisi_lopp_peatus: 'f',
    ...overrides,
  }
}

describe('buildIndex / resolvePlatform', () => {
  it('resolves a departure with no scheduled-time collision by time alone', () => {
    const index = buildIndex([row({ plaaniline_aeg: '13:47', peatuskoht: '4' })])
    expect(resolvePlatform(index, '13:47', 'Tartu')).toEqual({ platform: '4', changed: false })
  })

  it('reports a platform change', () => {
    const index = buildIndex([row({ peatuskoht_muutunud: 't' })])
    expect(resolvePlatform(index, '13:47', 'Tartu')).toEqual({ platform: '4', changed: true })
  })

  it('disambiguates a same-minute collision by destination — the Keila Paldiski/Tallinn case', () => {
    // Verified live at Keila 06:20: reis 540 Paldiski->Tallinn on platform 2,
    // reis 541 Tallinn->Paldiski on platform 1, same scheduled minute.
    const index = buildIndex([
      row({ plaaniline_aeg: '06:20', sihtjaam: 'Tallinn', peatuskoht: '2' }),
      row({ plaaniline_aeg: '06:20', sihtjaam: 'Paldiski', peatuskoht: '1' }),
    ])
    expect(resolvePlatform(index, '06:20', 'Tallinn')).toEqual({ platform: '2', changed: false })
    expect(resolvePlatform(index, '06:20', 'Paldiski')).toEqual({ platform: '1', changed: false })
  })

  it('folds destination diacritics the same way stop-search does (Türi/Türi)', () => {
    const index = buildIndex([
      row({ plaaniline_aeg: '13:29', sihtjaam: 'Türi', peatuskoht: '5' }),
      row({ plaaniline_aeg: '13:29', sihtjaam: 'Tartu', peatuskoht: '2' }),
    ])
    expect(resolvePlatform(index, '13:29', 'Türi')).toEqual({ platform: '5', changed: false })
  })

  it('returns undefined for an unresolvable same-minute collision (destination not among the candidates)', () => {
    const index = buildIndex([
      row({ plaaniline_aeg: '06:20', sihtjaam: 'Tallinn', peatuskoht: '2' }),
      row({ plaaniline_aeg: '06:20', sihtjaam: 'Paldiski', peatuskoht: '1' }),
    ])
    expect(resolvePlatform(index, '06:20', 'Narva')).toBeUndefined()
  })

  it('returns undefined for a time with no departure at all', () => {
    const index = buildIndex([row()])
    expect(resolvePlatform(index, '09:00', 'Tartu')).toBeUndefined()
  })

  it('still resolves a terminus row (reisi_lopp_peatus) — an arriving train has a platform too', () => {
    // Verified live: reis 658 Turba-Tallinn terminates at Tallinn on
    // platform 6, and Elron marks it reisi_lopp_peatus='t' but still
    // populates peatuskoht — nothing about being a terminus means "no
    // platform data".
    const index = buildIndex([row({ reisi_lopp_peatus: 't', peatuskoht: '6' })])
    expect(resolvePlatform(index, '13:47', 'Tartu')).toEqual({ platform: '6', changed: false })
  })
})

describe('fetchStationPlatformIndex', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('sends a real User-Agent and returns a usable index on success', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, data: [row({ plaaniline_aeg: '10:00', peatuskoht: '3' })] }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const index = await fetchStationPlatformIndex('Tallinn Test Station')
    expect(resolvePlatform(index!, '10:00', 'Tartu')).toEqual({ platform: '3', changed: false })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/live-map/stop/')
    expect((init.headers as Record<string, string>)['User-Agent']).toBeTruthy()
  })

  it('treats the "Pole andmeid" no-data shape as zero rows, not a crash', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, data: { text: 'Pole andmeid' } }),
    }) as unknown as typeof fetch

    const index = await fetchStationPlatformIndex('No Data Station')
    expect(index).toEqual(new Map())
  })

  it('returns null (not a throw) when the upstream request fails, so the board stays up without platforms', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch

    const index = await fetchStationPlatformIndex('Unreachable Station')
    expect(index).toBeNull()
  })

  it('routes a GTFS name containing a space through its Elron alias (Klooga aedlinn -> klooga-aedlinn)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, data: [] }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await fetchStationPlatformIndex('Klooga aedlinn')

    const [url] = fetchMock.mock.calls[0]
    expect(url).not.toContain('Klooga%20aedlinn')
    expect(url.toLowerCase()).toContain('klooga-aedlinn')
  })

  it('preserves diacritics in the request for a non-aliased name — Elron 404s a folded "ulemiste"', async () => {
    // Regression test: an earlier version of this module sent the FOLDED
    // (diacritic-stripped) name for every station, not just the aliased
    // ones. Confirmed live: elron.ee/live-map/stop/ulemiste returns "Pole
    // andmeid" while .../%C3%9Clemiste (Ülemiste) returns a real board —
    // Elron's endpoint is case-insensitive but not diacritic-insensitive.
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, data: [] }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await fetchStationPlatformIndex('Ülemiste')

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain(encodeURIComponent('Ülemiste'))
  })
})
