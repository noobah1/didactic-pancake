import {
  savePlace,
  getSavedPlaces,
  removeSavedPlace,
  addRecentSearch,
  getRecentSearches,
  Place,
} from '../storage'

// jest.config.ts runs tests under testEnvironment: 'node', so there is no
// browser `window`/`localStorage` by default — storage.ts checks for that
// and no-ops. We install a minimal in-memory Storage before each test so
// the read/write paths actually exercise the persistence logic.

class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length() {
    return this.store.size
  }
  clear(): void {
    this.store.clear()
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

let memoryStorage: MemoryStorage

beforeEach(() => {
  memoryStorage = new MemoryStorage()
  // @ts-expect-error — minimal Window shape is sufficient for storage.ts
  global.window = { localStorage: memoryStorage }
})

afterEach(() => {
  // @ts-expect-error — cleanup between tests
  delete global.window
})

const place = (name: string, lat: number, lng: number): Place => ({ name, lat, lng })

describe('storage', () => {
  it('returns an empty list when nothing has been saved', () => {
    expect(getSavedPlaces()).toEqual([])
    expect(getRecentSearches()).toEqual([])
  })

  it('saves and reads back a pinned place', () => {
    savePlace(place('Viru väljak 2', 59.437, 24.754))
    const saved = getSavedPlaces()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ name: 'Viru väljak 2', kind: 'pin' })
  })

  it('treats home and work as singletons, replacing the previous entry', () => {
    savePlace(place('Old Home', 59.1, 24.1), 'home')
    savePlace(place('New Home', 59.2, 24.2), 'home')
    const saved = getSavedPlaces()
    const homes = saved.filter((p) => p.kind === 'home')
    expect(homes).toHaveLength(1)
    expect(homes[0].name).toBe('New Home')
  })

  it('dedupes pinned places by coordinates instead of replacing all pins', () => {
    savePlace(place('Pin A', 59.1, 24.1))
    savePlace(place('Pin B', 59.2, 24.2))
    savePlace(place('Pin A renamed', 59.1, 24.1))
    const pins = getSavedPlaces().filter((p) => p.kind === 'pin')
    expect(pins).toHaveLength(2)
    expect(pins.find((p) => p.lat === 59.1)?.name).toBe('Pin A renamed')
  })

  it('removes a saved place by id', () => {
    savePlace(place('Pin A', 59.1, 24.1))
    const [saved] = getSavedPlaces()
    removeSavedPlace(saved.id)
    expect(getSavedPlaces()).toEqual([])
  })

  it('dedupes a repeated from/to search and moves it to the front', () => {
    const a = place('A', 59.1, 24.1)
    const b = place('B', 59.2, 24.2)
    const c = place('C', 59.3, 24.3)
    addRecentSearch(a, b)
    addRecentSearch(a, c)
    addRecentSearch(a, b) // repeat of the first search
    const recents = getRecentSearches()
    expect(recents).toHaveLength(2)
    expect(recents[0].to.name).toBe('B')
    expect(recents[1].to.name).toBe('C')
  })

  it('caps recent searches at 8, dropping the oldest', () => {
    const from = place('From', 59.0, 24.0)
    for (let i = 0; i < 10; i++) {
      addRecentSearch(from, place(`Dest ${i}`, 59.0 + i, 24.0 + i))
    }
    const recents = getRecentSearches()
    expect(recents).toHaveLength(8)
    expect(recents[0].to.name).toBe('Dest 9')
    expect(recents[recents.length - 1].to.name).toBe('Dest 2')
  })

  it('never throws when localStorage.setItem throws (quota exceeded)', () => {
    memoryStorage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(() => savePlace(place('Pin A', 59.1, 24.1))).not.toThrow()
  })

  it('never throws and returns the fallback when stored JSON is corrupt', () => {
    memoryStorage.setItem('livetravely.v1.savedPlaces', '{not valid json')
    expect(getSavedPlaces()).toEqual([])
  })

  it('returns fallbacks outside a browser environment', () => {
    // @ts-expect-error — simulate SSR, where window is undefined
    delete global.window
    expect(getSavedPlaces()).toEqual([])
    expect(getRecentSearches()).toEqual([])
    expect(() => savePlace(place('Pin A', 59.1, 24.1))).not.toThrow()
  })
})
