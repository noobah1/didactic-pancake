export interface Place {
  name: string
  lat: number
  lng: number
}

export interface SavedPlace extends Place {
  id: string
  kind: 'home' | 'work' | 'pin'
}

export interface RecentSearch {
  id: string
  from: Place
  to: Place
  ts: number
}

const NS = 'livetravely.v1'
const MAX_RECENTS = 8

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(`${NS}.${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    // private mode, disabled storage, or corrupt JSON — never fatal
    return fallback
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`${NS}.${key}`, JSON.stringify(value))
  } catch {
    // quota exceeded — dropping the write is the correct behaviour here
  }
}

export function getSavedPlaces(): SavedPlace[] {
  return read<SavedPlace[]>('savedPlaces', [])
}

export function savePlace(place: Place, kind: SavedPlace['kind'] = 'pin'): SavedPlace[] {
  const existing = getSavedPlaces()
  // home/work are singletons; pins are deduped by coordinates
  const filtered = existing.filter((p) =>
    kind === 'pin'
      ? !(p.lat === place.lat && p.lng === place.lng)
      : p.kind !== kind,
  )
  const next = [...filtered, { ...place, kind, id: `${kind}-${Date.now()}` }]
  write('savedPlaces', next)
  return next
}

export function removeSavedPlace(id: string): SavedPlace[] {
  const next = getSavedPlaces().filter((p) => p.id !== id)
  write('savedPlaces', next)
  return next
}

export function getRecentSearches(): RecentSearch[] {
  return read<RecentSearch[]>('recentSearches', [])
}

export function addRecentSearch(from: Place, to: Place): RecentSearch[] {
  const key = (p: Place) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
  const deduped = getRecentSearches().filter(
    (r) => !(key(r.from) === key(from) && key(r.to) === key(to)),
  )
  const next = [{ id: `${Date.now()}`, from, to, ts: Date.now() }, ...deduped].slice(0, MAX_RECENTS)
  write('recentSearches', next)
  return next
}
