import {
  foldName,
  tokenize,
  scoreName,
  clusterByLocation,
  nearestCityName,
  distanceToNearestActiveCity,
  SearchableStop,
} from '../stop-search'

function stop(gtfsId: string, name: string, lat: number, lon: number): SearchableStop {
  return { gtfsId, name, lat, lon }
}

describe('foldName', () => {
  it('folds every Estonian diacritic a rider might skip typing', () => {
    // ~30% of served stop names contain one of these; before folding, typing
    // the plain letter returned zero results for all of them.
    expect(foldName('Ülemiste')).toBe('ulemiste')
    expect(foldName('Pärnu maantee')).toBe('parnu maantee')
    expect(foldName('Mustamäe tee')).toBe('mustamae tee')
    expect(foldName('Lõhmuse')).toBe('lohmuse')
    expect(foldName('Vabaduse väljak')).toBe('vabaduse valjak')
    expect(foldName('Šiauliai')).toBe('siauliai')
    expect(foldName('Žanr')).toBe('zanr')
  })

  it('trims surrounding whitespace', () => {
    // " Lille" used to return zero results.
    expect(foldName('  Lille  ')).toBe('lille')
  })
})

describe('tokenize', () => {
  it('splits on whitespace and drops empties', () => {
    expect(tokenize('  Lille   peatus ')).toEqual(['lille', 'peatus'])
    expect(tokenize('   ')).toEqual([])
  })
})

describe('scoreName', () => {
  const score = (name: string, query: string) =>
    scoreName(foldName(name), foldName(query), tokenize(query))

  it('ranks an exact match above a name that merely starts with the query', () => {
    // The original bug: searching "Lille" listed "Lilleküla" first.
    expect(score('Lille', 'Lille')).toBeGreaterThan(score('Lilleküla', 'Lille'))
  })

  it('ranks a prefix match above an incidental substring match', () => {
    expect(score('Lilleküla', 'Lille')).toBeGreaterThan(score('Sinilille', 'Lille'))
  })

  it('still scores a stop when the query adds a descriptor word', () => {
    // "Lille peatus" = "the Lille stop"; previously returned nothing.
    expect(score('Lille', 'Lille peatus')).toBeGreaterThan(0)
  })

  it('scores a full multi-word match above a partial one', () => {
    expect(score('Mere puiestee', 'Mere puiestee')).toBeGreaterThan(
      score('Mere tee', 'Mere puiestee'),
    )
  })

  it('gives zero to a name sharing no token with the query', () => {
    expect(score('Kadriorg', 'Lille')).toBe(0)
  })

  it('matches diacritic-free typing against the real name', () => {
    expect(score('Ülemiste', 'Ulemiste')).toBe(1000)
    expect(score('Pärnu maantee', 'parnu maantee')).toBe(1000)
  })
})

describe('clusterByLocation', () => {
  // Real coordinates of stops named "Lille" in the live graph.
  const tallinnA = stop('1:1138', 'Lille', 59.4312, 24.7125)
  const tallinnB = stop('1:1139', 'Lille', 59.4321, 24.7136)
  const tartu = stop('1:144830', 'Lille', 58.3737, 26.7249)
  const elva = stop('1:29993', 'Lille', 58.2159, 26.3947)
  const kuressaare = stop('1:23845', 'Lille', 58.2594, 22.5183)

  it('keeps two platforms of the same stop together', () => {
    const clusters = clusterByLocation([tallinnA, tallinnB], 2000)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toHaveLength(2)
  })

  it('never merges same-named stops in different towns', () => {
    // This is what made "Lille" in Tallinn open a board centred on Elva.
    const clusters = clusterByLocation([elva, tallinnA, tallinnB, tartu, kuressaare], 2000)
    expect(clusters).toHaveLength(4)
    const tallinnCluster = clusters.find((c) => c.some((s) => s.gtfsId === '1:1138'))
    expect(tallinnCluster?.map((s) => s.gtfsId).sort()).toEqual(['1:1138', '1:1139'])
  })

  it('returns an empty list for no input', () => {
    expect(clusterByLocation([], 2000)).toEqual([])
  })
})

describe('nearestCityName', () => {
  it('labels stops with the town they are actually in', () => {
    expect(nearestCityName(59.4312, 24.7125, 30_000)).toBe('Tallinn')
    expect(nearestCityName(58.2159, 26.3947, 30_000)).toBe('Elva')
    expect(nearestCityName(58.3737, 26.7249, 30_000)).toBe('Tartu')
  })

  it('returns null when nothing is close enough to name honestly', () => {
    // Far offshore in the Baltic Sea — nowhere near any listed city.
    expect(nearestCityName(58.5, 19.5, 30_000)).toBeNull()
  })
})

describe('distanceToNearestActiveCity', () => {
  const tallinn = { lat: 59.437, lng: 24.7536 }
  const tartu = { lat: 58.378, lng: 26.729 }

  it('returns null when the rider has no city filter active', () => {
    expect(distanceToNearestActiveCity(59.4312, 24.7125, [])).toBeNull()
  })

  it('measures to the closest active city, not the first', () => {
    const d = distanceToNearestActiveCity(58.3737, 26.7249, [tallinn, tartu])
    expect(d).not.toBeNull()
    expect(d!).toBeLessThan(2000)
  })

  it('reports a far distance for a stop in an unselected town', () => {
    const d = distanceToNearestActiveCity(58.2159, 26.3947, [tallinn])
    expect(d!).toBeGreaterThan(100_000)
  })
})
