# Tallinn Transit App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a web-based public transport app for Tallinn with route planning, live vehicle tracking, and service disruption alerts.

**Architecture:** Next.js 14+ (App Router) frontend with API routes proxying data from OpenTripPlanner (route planning) and Tallinn's custom GPS feed (live vehicles). MapLibre GL for map rendering. No database, no auth.

**Tech Stack:** Next.js, TypeScript, MapLibre GL JS, OpenTripPlanner 2, Docker Compose, Tailwind CSS

**Data Sources:**

- Static GTFS (all Estonia): `https://peatus.ee/gtfs/gtfs.zip`
- Live vehicle GPS: `https://transport.tallinn.ee/gps.txt` (custom CSV format, not GTFS-RT protobuf)
- Stop departures: `https://transport.tallinn.ee/siri-stop-departures.php?stopid=STOPID`
- Geocoding: Nominatim (OpenStreetMap)

**Note on GPS format:** The `gps.txt` feed returns lines like:

```
3,2,24711780,59448550,,142,96,Z,147,Suur-Paala
```

Fields: type (1=tram,2=trolley,3=bus), line, lng*1e6, lat*1e6, _, heading, vehicleId, status, _, destination

---

## Task 1: Project Scaffolding

**Files:**

- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.eslintrc.json`, `.prettierrc`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`

**Step 1: Initialize Next.js project**

Run:

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias --use-npm
```

Expected: Project scaffolded with Next.js, TypeScript, Tailwind, ESLint, App Router, src directory.

**Step 2: Add Prettier**

Run:

```bash
npm install --save-dev prettier eslint-config-prettier
```

Create `.prettierrc`:

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

Update `.eslintrc.json` to extend `"prettier"`.

**Step 3: Clean up boilerplate**

Replace `src/app/page.tsx` with:

```tsx
export default function Home() {
  return (
    <main className="h-screen flex flex-col">
      <h1 className="p-4 text-xl font-bold">Tallinn Transit</h1>
    </main>
  )
}
```

Replace `src/app/layout.tsx` metadata title with "Tallinn Transit" and description with "Public transport route planner for Tallinn".

**Step 4: Verify it runs**

Run: `npm run dev`
Expected: App loads at localhost:3000 with "Tallinn Transit" heading.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js project with TypeScript, Tailwind, ESLint, Prettier"
```

---

## Task 2: Docker Compose with OpenTripPlanner

**Files:**

- Create: `docker-compose.yml`, `otp/Dockerfile`, `otp/build-config.json`, `otp/router-config.json`, `scripts/download-gtfs.sh`

**Step 1: Create GTFS download script**

Create `scripts/download-gtfs.sh`:

```bash
#!/bin/bash
set -e
mkdir -p otp/data
echo "Downloading Estonia GTFS data..."
curl -L -o otp/data/gtfs.zip https://peatus.ee/gtfs/gtfs.zip
echo "GTFS data downloaded to otp/data/gtfs.zip"
```

Run: `chmod +x scripts/download-gtfs.sh`

**Step 2: Create OTP configuration**

Create `otp/build-config.json`:

```json
{
  "transitFeeds": [
    {
      "type": "gtfs",
      "source": "data/gtfs.zip"
    }
  ]
}
```

Create `otp/router-config.json`:

```json
{
  "routingDefaults": {
    "walkSpeed": 1.3,
    "bikeSpeed": 5.0
  },
  "server": {
    "requestLogFile": "/var/otp/request.log"
  }
}
```

**Step 3: Create Docker Compose**

Create `docker-compose.yml`:

```yaml
services:
  otp:
    image: opentripplanner/opentripplanner:2.6.0
    ports:
      - '8080:8080'
    volumes:
      - ./otp/data:/var/opentripplanner/data
      - ./otp/build-config.json:/var/opentripplanner/build-config.json
      - ./otp/router-config.json:/var/opentripplanner/router-config.json
    command: ['--load', '--serve']
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:8080/otp/actuators/health']
      interval: 30s
      timeout: 10s
      retries: 5
```

**Step 4: Download GTFS and build OTP graph**

Run:

```bash
./scripts/download-gtfs.sh
docker compose run --rm otp --build --save
```

Expected: OTP downloads OSM data and builds a routing graph from the GTFS data. This may take several minutes.

**Step 5: Start OTP and verify**

Run: `docker compose up -d otp`

Wait for health check, then:

```bash
curl http://localhost:8080/otp/routers/default/index/routes | head -c 500
```

Expected: JSON array of route objects.

**Step 6: Add .gitignore entries**

Append to `.gitignore`:

```
otp/data/
```

**Step 7: Commit**

```bash
git add docker-compose.yml otp/ scripts/ .gitignore
git commit -m "feat: add Docker Compose with OpenTripPlanner and GTFS download script"
```

---

## Task 3: Shared Types and Constants

**Files:**

- Create: `src/lib/types.ts`, `src/lib/constants.ts`

**Step 1: Define transport types and shared interfaces**

Create `src/lib/types.ts`:

```typescript
export type TransportMode = 'bus' | 'tram' | 'trolleybus' | 'train' | 'ferry'

export interface VehiclePosition {
  id: string
  mode: TransportMode
  line: string
  lat: number
  lng: number
  heading: number
  destination: string
}

export interface RouteResult {
  id: string
  legs: RouteLeg[]
  duration: number // seconds
  startTime: string // ISO timestamp
  endTime: string
  walkDistance: number // meters
}

export interface RouteLeg {
  mode: TransportMode | 'walk'
  from: LegPlace
  to: LegPlace
  startTime: string
  endTime: string
  duration: number
  route?: string // line number
  tripId?: string
  intermediateStops?: LegPlace[]
  legGeometry?: { points: string } // encoded polyline
  realtime?: boolean
  delay?: number // seconds
}

export interface LegPlace {
  name: string
  lat: number
  lng: number
  stopId?: string
  departure?: string
  arrival?: string
}

export interface ServiceAlert {
  id: string
  headerText: string
  descriptionText: string
  severity: 'info' | 'warning' | 'severe'
  affectedRoutes: string[]
  activePeriodStart?: string
  activePeriodEnd?: string
}

export interface SearchFilters {
  modes: TransportMode[]
  departureTime: 'now' | string // ISO timestamp
}
```

**Step 2: Define constants**

Create `src/lib/constants.ts`:

```typescript
import { TransportMode } from './types'

export const OTP_BASE_URL = process.env.OTP_BASE_URL || 'http://localhost:8080'
export const GPS_FEED_URL = 'https://transport.tallinn.ee/gps.txt'
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'

export const TALLINN_CENTER = { lat: 59.437, lng: 24.7536 }
export const DEFAULT_ZOOM = 13

export const POLL_INTERVALS = {
  vehiclePositions: 7_000, // ms
  tripUpdates: 30_000,
  serviceAlerts: 60_000,
}

// Mapping from gps.txt type codes to our transport modes
export const GPS_TYPE_MAP: Record<string, TransportMode> = {
  '1': 'tram',
  '2': 'trolleybus',
  '3': 'bus',
  '4': 'train',
  '5': 'ferry',
}

export const MODE_COLORS: Record<TransportMode, string> = {
  bus: '#4CAF50',
  tram: '#F44336',
  trolleybus: '#2196F3',
  train: '#FF9800',
  ferry: '#9C27B0',
}

export const MODE_LABELS: Record<TransportMode, string> = {
  bus: 'Bus',
  tram: 'Tram',
  trolleybus: 'Trolleybus',
  train: 'Train',
  ferry: 'Ferry',
}

export const ALL_MODES: TransportMode[] = ['bus', 'tram', 'trolleybus', 'train', 'ferry']
```

**Step 3: Commit**

```bash
git add src/lib/
git commit -m "feat: add shared types and constants"
```

---

## Task 4: API Route — Vehicle Positions

**Files:**

- Create: `src/lib/parse-gps.ts`, `src/app/api/vehicles/route.ts`
- Test: `src/lib/__tests__/parse-gps.test.ts`

**Step 1: Install test dependencies**

Run:

```bash
npm install --save-dev jest @types/jest ts-jest @jest/globals
npx ts-jest config:init
```

**Step 2: Write the failing test for GPS parser**

Create `src/lib/__tests__/parse-gps.test.ts`:

```typescript
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
```

**Step 3: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/parse-gps.test.ts`
Expected: FAIL — module not found.

**Step 4: Implement GPS parser**

Create `src/lib/parse-gps.ts`:

```typescript
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
```

**Step 5: Run test to verify it passes**

Run: `npx jest src/lib/__tests__/parse-gps.test.ts`
Expected: PASS — all 4 tests pass.

**Step 6: Create the API route**

Create `src/app/api/vehicles/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { GPS_FEED_URL } from '@/lib/constants'
import { parseGpsFeed } from '@/lib/parse-gps'
import { TransportMode } from '@/lib/types'

let cache: { data: ReturnType<typeof parseGpsFeed>; timestamp: number } | null = null
const CACHE_TTL = 5_000 // 5 seconds

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const modesParam = searchParams.get('modes')
  const modes = modesParam ? (modesParam.split(',') as TransportMode[]) : null

  try {
    const now = Date.now()
    if (!cache || now - cache.timestamp > CACHE_TTL) {
      const response = await fetch(GPS_FEED_URL, { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`GPS feed returned ${response.status}`)
      }
      const text = await response.text()
      cache = { data: parseGpsFeed(text), timestamp: now }
    }

    let vehicles = cache.data
    if (modes) {
      vehicles = vehicles.filter((v) => modes.includes(v.mode))
    }

    return NextResponse.json({
      vehicles,
      timestamp: cache.timestamp,
    })
  } catch (error) {
    console.error('Failed to fetch vehicle positions:', error)
    if (cache) {
      return NextResponse.json({
        vehicles: cache.data,
        timestamp: cache.timestamp,
        stale: true,
      })
    }
    return NextResponse.json({ error: 'Failed to fetch vehicle positions' }, { status: 502 })
  }
}
```

**Step 7: Commit**

```bash
git add src/lib/parse-gps.ts src/lib/__tests__/ src/app/api/vehicles/ jest.config.ts
git commit -m "feat: add vehicle positions API route with GPS feed parser"
```

---

## Task 5: API Route — Route Planning (OTP Proxy)

**Files:**

- Create: `src/app/api/plan/route.ts`

**Step 1: Create the route planning API route**

Create `src/app/api/plan/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { OTP_BASE_URL } from '@/lib/constants'
import { TransportMode, RouteResult, RouteLeg, LegPlace } from '@/lib/types'

const MODE_TO_OTP: Record<TransportMode, string> = {
  bus: 'BUS',
  tram: 'TRAM',
  trolleybus: 'TROLLEYBUS',
  train: 'RAIL',
  ferry: 'FERRY',
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fromPlace = searchParams.get('fromPlace')
  const toPlace = searchParams.get('toPlace')
  const modesParam = searchParams.get('modes')
  const dateTime = searchParams.get('dateTime')

  if (!fromPlace || !toPlace) {
    return NextResponse.json({ error: 'fromPlace and toPlace are required' }, { status: 400 })
  }

  const transitModes = modesParam
    ? modesParam
        .split(',')
        .map((m) => MODE_TO_OTP[m as TransportMode])
        .filter(Boolean)
        .join(',')
    : 'BUS,TRAM,TROLLEYBUS,RAIL,FERRY'

  const params = new URLSearchParams({
    fromPlace,
    toPlace,
    mode: `WALK,TRANSIT`,
    transitModes,
    numItineraries: '5',
    ...(dateTime ? { date: dateTime.split('T')[0], time: dateTime.split('T')[1] } : {}),
  })

  try {
    const response = await fetch(`${OTP_BASE_URL}/otp/routers/default/plan?${params}`, {
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`OTP returned ${response.status}`)
    }

    const data = await response.json()

    if (data.error) {
      return NextResponse.json({ error: data.error.message || 'No routes found' }, { status: 404 })
    }

    const routes: RouteResult[] = (data.plan?.itineraries || []).map((it: any, index: number) => ({
      id: `route-${index}`,
      duration: it.duration,
      startTime: new Date(it.startTime).toISOString(),
      endTime: new Date(it.endTime).toISOString(),
      walkDistance: it.walkDistance,
      legs: it.legs.map(
        (leg: any): RouteLeg => ({
          mode: leg.mode === 'WALK' ? 'walk' : otpModeToLocal(leg.mode),
          from: mapPlace(leg.from),
          to: mapPlace(leg.to),
          startTime: new Date(leg.startTime).toISOString(),
          endTime: new Date(leg.endTime).toISOString(),
          duration: leg.duration,
          route: leg.route || undefined,
          tripId: leg.tripId || undefined,
          legGeometry: leg.legGeometry || undefined,
          realtime: leg.realTime || false,
          delay: leg.departureDelay || 0,
        }),
      ),
    }))

    return NextResponse.json({ routes })
  } catch (error) {
    console.error('Failed to fetch route plan:', error)
    return NextResponse.json({ error: 'Route planning service unavailable' }, { status: 502 })
  }
}

function otpModeToLocal(otpMode: string): TransportMode {
  const map: Record<string, TransportMode> = {
    BUS: 'bus',
    TRAM: 'tram',
    TROLLEYBUS: 'trolleybus',
    RAIL: 'train',
    FERRY: 'ferry',
  }
  return map[otpMode] || 'bus'
}

function mapPlace(place: any): LegPlace {
  return {
    name: place.name || '',
    lat: place.lat,
    lng: place.lon,
    stopId: place.stopId || undefined,
    departure: place.departure ? new Date(place.departure).toISOString() : undefined,
    arrival: place.arrival ? new Date(place.arrival).toISOString() : undefined,
  }
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/app/api/plan/
git commit -m "feat: add route planning API route (OTP proxy)"
```

---

## Task 6: API Route — Geocoding Proxy

**Files:**

- Create: `src/app/api/geocode/route.ts`

**Step 1: Create the geocoding proxy**

Create `src/app/api/geocode/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { NOMINATIM_URL, TALLINN_CENTER } from '@/lib/constants'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] })
  }

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      addressdetails: '1',
      limit: '5',
      viewbox: '24.55,59.50,24.95,59.35',
      bounded: '1',
    })

    const response = await fetch(`${NOMINATIM_URL}/search?${params}`, {
      headers: { 'User-Agent': 'TallinnTransit/1.0' },
    })

    if (!response.ok) {
      throw new Error(`Nominatim returned ${response.status}`)
    }

    const data = await response.json()
    const results = data.map((item: any) => ({
      name: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    }))

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Geocoding failed:', error)
    return NextResponse.json({ results: [] })
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/geocode/
git commit -m "feat: add geocoding API route (Nominatim proxy)"
```

---

## Task 7: API Route — Service Alerts

**Files:**

- Create: `src/app/api/alerts/route.ts`

**Step 1: Create the service alerts API route**

The OTP instance exposes alerts from GTFS data. We proxy and normalize them.

Create `src/app/api/alerts/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { OTP_BASE_URL } from '@/lib/constants'
import { ServiceAlert } from '@/lib/types'

let cache: { data: ServiceAlert[]; timestamp: number } | null = null
const CACHE_TTL = 60_000 // 1 minute

export async function GET() {
  try {
    const now = Date.now()
    if (cache && now - cache.timestamp < CACHE_TTL) {
      return NextResponse.json({ alerts: cache.data, timestamp: cache.timestamp })
    }

    const response = await fetch(`${OTP_BASE_URL}/otp/routers/default/alerts`, {
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`OTP alerts returned ${response.status}`)
    }

    const data = await response.json()
    const alerts: ServiceAlert[] = (data || []).map((alert: any) => ({
      id: alert.id || String(Math.random()),
      headerText: alert.alertHeaderText || 'Service alert',
      descriptionText: alert.alertDescriptionText || '',
      severity: mapSeverity(alert.severity),
      affectedRoutes: (alert.entities || []).filter((e: any) => e.route).map((e: any) => e.route),
      activePeriodStart: alert.effectiveStartDate
        ? new Date(alert.effectiveStartDate).toISOString()
        : undefined,
      activePeriodEnd: alert.effectiveEndDate
        ? new Date(alert.effectiveEndDate).toISOString()
        : undefined,
    }))

    cache = { data: alerts, timestamp: now }
    return NextResponse.json({ alerts, timestamp: now })
  } catch (error) {
    console.error('Failed to fetch alerts:', error)
    if (cache) {
      return NextResponse.json({ alerts: cache.data, timestamp: cache.timestamp, stale: true })
    }
    return NextResponse.json({ alerts: [] })
  }
}

function mapSeverity(severity?: string): ServiceAlert['severity'] {
  if (!severity) return 'info'
  if (severity === 'SEVERE' || severity === 'WARNING') return 'severe'
  if (severity === 'INFO') return 'info'
  return 'warning'
}
```

**Step 2: Commit**

```bash
git add src/app/api/alerts/
git commit -m "feat: add service alerts API route"
```

---

## Task 8: Custom Hooks — Data Fetching

**Files:**

- Create: `src/hooks/use-vehicles.ts`, `src/hooks/use-route-plan.ts`, `src/hooks/use-geocode.ts`, `src/hooks/use-alerts.ts`, `src/hooks/use-polling.ts`

**Step 1: Create polling utility hook**

Create `src/hooks/use-polling.ts`:

```typescript
import { useEffect, useRef, useCallback, useState } from 'react'

export function usePolling<T>(
  fetcher: () => Promise<T>,
  interval: number,
  enabled: boolean = true,
) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval>>()

  const poll = useCallback(async () => {
    try {
      const result = await fetcher()
      setData(result)
      setError(null)
      setLastUpdated(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Polling failed'))
    }
  }, [fetcher])

  useEffect(() => {
    if (!enabled) {
      clearInterval(timerRef.current)
      return
    }

    poll()
    timerRef.current = setInterval(poll, interval)
    return () => clearInterval(timerRef.current)
  }, [poll, interval, enabled])

  // Pause polling when tab is hidden
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(timerRef.current)
      } else if (enabled) {
        poll()
        timerRef.current = setInterval(poll, interval)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [poll, interval, enabled])

  return { data, error, lastUpdated }
}
```

**Step 2: Create vehicle positions hook**

Create `src/hooks/use-vehicles.ts`:

```typescript
import { useCallback } from 'react'
import { usePolling } from './use-polling'
import { VehiclePosition, TransportMode } from '@/lib/types'
import { POLL_INTERVALS } from '@/lib/constants'

interface VehicleResponse {
  vehicles: VehiclePosition[]
  timestamp: number
  stale?: boolean
}

export function useVehicles(modes: TransportMode[]) {
  const fetcher = useCallback(async (): Promise<VehicleResponse> => {
    const params = new URLSearchParams({ modes: modes.join(',') })
    const res = await fetch(`/api/vehicles?${params}`)
    if (!res.ok) throw new Error('Failed to fetch vehicles')
    return res.json()
  }, [modes.join(',')])

  return usePolling(fetcher, POLL_INTERVALS.vehiclePositions)
}
```

**Step 3: Create route planning hook**

Create `src/hooks/use-route-plan.ts`:

```typescript
import { useState, useCallback } from 'react'
import { RouteResult, TransportMode } from '@/lib/types'

interface PlanResponse {
  routes: RouteResult[]
  error?: string
}

export function useRoutePlan() {
  const [routes, setRoutes] = useState<RouteResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = useCallback(
    async (fromPlace: string, toPlace: string, modes: TransportMode[], dateTime?: string) => {
      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          fromPlace,
          toPlace,
          modes: modes.join(','),
          ...(dateTime ? { dateTime } : {}),
        })

        const res = await fetch(`/api/plan?${params}`)
        const data: PlanResponse = await res.json()

        if (data.error) {
          setError(data.error)
          setRoutes([])
        } else {
          setRoutes(data.routes)
        }
      } catch {
        setError('Route planning service unavailable')
        setRoutes([])
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const clear = useCallback(() => {
    setRoutes([])
    setError(null)
  }, [])

  return { routes, loading, error, search, clear }
}
```

**Step 4: Create geocode hook**

Create `src/hooks/use-geocode.ts`:

```typescript
import { useState, useCallback, useRef } from 'react'

interface GeoResult {
  name: string
  lat: number
  lng: number
}

export function useGeocode() {
  const [results, setResults] = useState<GeoResult[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const search = useCallback((query: string) => {
    clearTimeout(debounceRef.current)

    if (query.length < 2) {
      setResults([])
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(data.results)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [])

  const clear = useCallback(() => setResults([]), [])

  return { results, loading, search, clear }
}
```

**Step 5: Create alerts hook**

Create `src/hooks/use-alerts.ts`:

```typescript
import { useCallback } from 'react'
import { usePolling } from './use-polling'
import { ServiceAlert } from '@/lib/types'
import { POLL_INTERVALS } from '@/lib/constants'

interface AlertsResponse {
  alerts: ServiceAlert[]
  timestamp: number
  stale?: boolean
}

export function useAlerts() {
  const fetcher = useCallback(async (): Promise<AlertsResponse> => {
    const res = await fetch('/api/alerts')
    if (!res.ok) throw new Error('Failed to fetch alerts')
    return res.json()
  }, [])

  return usePolling(fetcher, POLL_INTERVALS.serviceAlerts)
}
```

**Step 6: Commit**

```bash
git add src/hooks/
git commit -m "feat: add data fetching hooks (vehicles, route plan, geocode, alerts, polling)"
```

---

## Task 9: Page Layout Shell

**Files:**

- Modify: `src/app/page.tsx`, `src/app/globals.css`
- Create: `src/components/SearchPanel.tsx`, `src/components/MapView.tsx`

**Step 1: Create placeholder components**

Create `src/components/SearchPanel.tsx`:

```tsx
'use client'

export function SearchPanel() {
  return (
    <div className="flex flex-col gap-3 p-4 bg-white">
      <h1 className="text-xl font-bold">Tallinn Transit</h1>
      <p className="text-gray-500">Search panel placeholder</p>
    </div>
  )
}
```

Create `src/components/MapView.tsx`:

```tsx
'use client'

export function MapView() {
  return (
    <div className="flex-1 bg-gray-200 flex items-center justify-center">
      <p className="text-gray-500">Map placeholder</p>
    </div>
  )
}
```

**Step 2: Wire up the main page layout**

Update `src/app/page.tsx`:

```tsx
import { SearchPanel } from '@/components/SearchPanel'
import { MapView } from '@/components/MapView'

export default function Home() {
  return (
    <main className="h-dvh flex flex-col">
      <SearchPanel />
      <MapView />
    </main>
  )
}
```

**Step 3: Verify layout renders**

Run: `npm run dev`
Expected: Page shows search panel at top and grey map area filling the rest.

**Step 4: Commit**

```bash
git add src/app/page.tsx src/components/
git commit -m "feat: add page layout shell with search panel and map placeholders"
```

---

## Task 10: Search Bar with Autocomplete

**Files:**

- Create: `src/components/LocationInput.tsx`
- Modify: `src/components/SearchPanel.tsx`

**Step 1: Create the location input component**

Create `src/components/LocationInput.tsx`:

```tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { useGeocode } from '@/hooks/use-geocode'

interface LocationInputProps {
  label: string
  placeholder: string
  value: string
  onSelect: (name: string, lat: number, lng: number) => void
  onChange: (value: string) => void
}

export function LocationInput({
  label,
  placeholder,
  value,
  onSelect,
  onChange,
}: LocationInputProps) {
  const [showDropdown, setShowDropdown] = useState(false)
  const { results, search, clear } = useGeocode()
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleChange = (text: string) => {
    onChange(text)
    search(text)
    setShowDropdown(true)
  }

  const handleSelect = (result: { name: string; lat: number; lng: number }) => {
    onSelect(result.name, result.lat, result.lng)
    setShowDropdown(false)
    clear()
  }

  return (
    <div ref={wrapperRef} className="relative">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => results.length > 0 && setShowDropdown(true)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {showDropdown && results.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => handleSelect(r)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 truncate"
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

**Step 2: Update SearchPanel with location inputs and search button**

Update `src/components/SearchPanel.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { LocationInput } from './LocationInput'
import { TransportMode } from '@/lib/types'

interface SearchPanelProps {
  onSearch: (fromPlace: string, toPlace: string, modes: TransportMode[]) => void
  modes: TransportMode[]
}

export function SearchPanel({ onSearch, modes }: SearchPanelProps) {
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')
  const [fromCoords, setFromCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [toCoords, setToCoords] = useState<{ lat: number; lng: number } | null>(null)

  const handleSearch = () => {
    if (!fromCoords || !toCoords) return
    const fromPlace = `${fromCoords.lat},${fromCoords.lng}`
    const toPlace = `${toCoords.lat},${toCoords.lng}`
    onSearch(fromPlace, toPlace, modes)
  }

  return (
    <div className="flex flex-col gap-3 p-4 bg-white border-b border-gray-200">
      <h1 className="text-lg font-bold">Tallinn Transit</h1>
      <div className="flex flex-col gap-2">
        <LocationInput
          label="From"
          placeholder="Current location or search..."
          value={fromText}
          onChange={setFromText}
          onSelect={(name, lat, lng) => {
            setFromText(name)
            setFromCoords({ lat, lng })
          }}
        />
        <LocationInput
          label="To"
          placeholder="Where to?"
          value={toText}
          onChange={setToText}
          onSelect={(name, lat, lng) => {
            setToText(name)
            setToCoords({ lat, lng })
          }}
        />
      </div>
      <button
        onClick={handleSearch}
        disabled={!fromCoords || !toCoords}
        className="w-full py-2 bg-blue-600 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
      >
        Search routes
      </button>
    </div>
  )
}
```

**Step 3: Verify it renders**

Run: `npm run dev`
Expected: Search panel with From/To inputs and a Search button.

**Step 4: Commit**

```bash
git add src/components/LocationInput.tsx src/components/SearchPanel.tsx
git commit -m "feat: add search bar with geocoding autocomplete"
```

---

## Task 11: Transport Filter Chips

**Files:**

- Create: `src/components/FilterChips.tsx`
- Modify: `src/app/page.tsx`

**Step 1: Create the filter chips component**

Create `src/components/FilterChips.tsx`:

```tsx
'use client'

import { TransportMode } from '@/lib/types'
import { MODE_LABELS, MODE_COLORS, ALL_MODES } from '@/lib/constants'

interface FilterChipsProps {
  activeModes: TransportMode[]
  onToggle: (mode: TransportMode) => void
}

export function FilterChips({ activeModes, onToggle }: FilterChipsProps) {
  return (
    <div className="flex gap-2 px-4 py-2 bg-white border-b border-gray-200 overflow-x-auto">
      {ALL_MODES.map((mode) => {
        const active = activeModes.includes(mode)
        return (
          <button
            key={mode}
            onClick={() => onToggle(mode)}
            className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap transition-colors border ${
              active ? 'text-white border-transparent' : 'text-gray-500 bg-white border-gray-300'
            }`}
            style={active ? { backgroundColor: MODE_COLORS[mode] } : undefined}
          >
            {MODE_LABELS[mode]}
          </button>
        )
      })}
    </div>
  )
}
```

**Step 2: Wire filters into the main page with URL state**

Update `src/app/page.tsx` to manage filter state:

```tsx
'use client'

import { useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { SearchPanel } from '@/components/SearchPanel'
import { FilterChips } from '@/components/FilterChips'
import { MapView } from '@/components/MapView'
import { TransportMode } from '@/lib/types'
import { ALL_MODES } from '@/lib/constants'

export default function Home() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const modesFromUrl = searchParams.get('modes')
  const [activeModes, setActiveModes] = useState<TransportMode[]>(
    modesFromUrl ? (modesFromUrl.split(',') as TransportMode[]) : [...ALL_MODES],
  )

  const handleToggle = useCallback(
    (mode: TransportMode) => {
      setActiveModes((prev) => {
        const next = prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
        if (next.length === 0) return prev // Don't allow empty
        const params = new URLSearchParams(searchParams.toString())
        if (next.length === ALL_MODES.length) {
          params.delete('modes')
        } else {
          params.set('modes', next.join(','))
        }
        router.replace(`?${params.toString()}`, { scroll: false })
        return next
      })
    },
    [searchParams, router],
  )

  const handleSearch = (fromPlace: string, toPlace: string, modes: TransportMode[]) => {
    // Will be connected in Task 13
    console.log('Search:', { fromPlace, toPlace, modes })
  }

  return (
    <main className="h-dvh flex flex-col">
      <SearchPanel onSearch={handleSearch} modes={activeModes} />
      <FilterChips activeModes={activeModes} onToggle={handleToggle} />
      <MapView />
    </main>
  )
}
```

**Step 3: Verify filter toggling works**

Run: `npm run dev`
Expected: Colored chips toggle on/off, URL updates with `?modes=bus,tram,...`

**Step 4: Commit**

```bash
git add src/components/FilterChips.tsx src/app/page.tsx
git commit -m "feat: add transport mode filter chips with URL state persistence"
```

---

## Task 12: Live Map with MapLibre

**Files:**

- Modify: `src/components/MapView.tsx`

**Step 1: Install MapLibre**

Run:

```bash
npm install maplibre-gl
```

**Step 2: Implement the map component**

Update `src/components/MapView.tsx`:

```tsx
'use client'

import { useRef, useEffect, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { TALLINN_CENTER, DEFAULT_ZOOM, MODE_COLORS } from '@/lib/constants'
import { VehiclePosition, TransportMode } from '@/lib/types'

interface MapViewProps {
  vehicles?: VehiclePosition[]
  activeModes: TransportMode[]
  routeGeometry?: string // encoded polyline
  onStopClick?: (stopId: string) => void
}

export function MapView({ vehicles, activeModes, routeGeometry }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [TALLINN_CENTER.lng, TALLINN_CENTER.lat],
      zoom: DEFAULT_ZOOM,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-right',
    )

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Update vehicle markers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !vehicles) return

    const currentIds = new Set<string>()

    vehicles
      .filter((v) => activeModes.includes(v.mode))
      .forEach((vehicle) => {
        currentIds.add(vehicle.id)
        const existing = markersRef.current.get(vehicle.id)

        if (existing) {
          existing.setLngLat([vehicle.lng, vehicle.lat])
        } else {
          const el = document.createElement('div')
          el.className = 'vehicle-marker'
          el.style.width = '12px'
          el.style.height = '12px'
          el.style.borderRadius = '50%'
          el.style.backgroundColor = MODE_COLORS[vehicle.mode]
          el.style.border = '2px solid white'
          el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'
          el.title = `${vehicle.mode} ${vehicle.line} → ${vehicle.destination}`

          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([vehicle.lng, vehicle.lat])
            .setPopup(
              new maplibregl.Popup({ offset: 10 }).setHTML(
                `<strong>${vehicle.line}</strong><br/>${vehicle.destination}`,
              ),
            )
            .addTo(map)

          markersRef.current.set(vehicle.id, marker)
        }
      })

    // Remove markers for vehicles no longer present or filtered out
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove()
        markersRef.current.delete(id)
      }
    })
  }, [vehicles, activeModes])

  return <div ref={containerRef} className="flex-1" />
}
```

**Step 3: Verify map renders**

Run: `npm run dev`
Expected: MapLibre map centered on Tallinn with zoom/geolocate controls.

**Step 4: Commit**

```bash
git add src/components/MapView.tsx package.json package-lock.json
git commit -m "feat: add live MapLibre map with vehicle markers"
```

---

## Task 13: Route Results Component & Full Wiring

**Files:**

- Create: `src/components/RouteResults.tsx`, `src/components/RouteCard.tsx`, `src/components/AlertBanner.tsx`
- Modify: `src/app/page.tsx`

**Step 1: Create RouteCard component**

Create `src/components/RouteCard.tsx`:

```tsx
'use client'

import { RouteResult } from '@/lib/types'
import { MODE_COLORS } from '@/lib/constants'

interface RouteCardProps {
  route: RouteResult
  selected: boolean
  onSelect: () => void
}

export function RouteCard({ route, selected, onSelect }: RouteCardProps) {
  const transitLegs = route.legs.filter((l) => l.mode !== 'walk')
  const totalMinutes = Math.round(route.duration / 60)
  const startTime = new Date(route.startTime).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  const maxDelay = Math.max(...route.legs.map((l) => l.delay || 0))
  const delayMinutes = Math.round(maxDelay / 60)

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-lg border transition-colors ${
        selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {transitLegs.map((leg, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-gray-400 text-xs">→</span>}
              <span
                className="px-2 py-0.5 rounded text-xs font-bold text-white"
                style={{ backgroundColor: MODE_COLORS[leg.mode === 'walk' ? 'bus' : leg.mode] }}
              >
                {leg.route || leg.mode}
              </span>
            </span>
          ))}
        </div>
        <span className="font-bold text-sm">{totalMinutes} min</span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-gray-500">Depart {startTime}</span>
        {delayMinutes > 0 ? (
          <span className="text-xs text-amber-600 font-medium">⚠ {delayMinutes}min delay</span>
        ) : (
          <span className="text-xs text-green-600 font-medium">✓ on time</span>
        )}
      </div>
    </button>
  )
}
```

**Step 2: Create RouteResults component**

Create `src/components/RouteResults.tsx`:

```tsx
'use client'

import { RouteResult } from '@/lib/types'
import { RouteCard } from './RouteCard'

interface RouteResultsProps {
  routes: RouteResult[]
  loading: boolean
  error: string | null
  selectedId: string | null
  onSelect: (id: string) => void
}

export function RouteResults({ routes, loading, error, selectedId, onSelect }: RouteResultsProps) {
  if (loading) {
    return <div className="p-4 text-center text-gray-500 text-sm">Searching routes...</div>
  }

  if (error) {
    return <div className="p-4 text-center text-red-500 text-sm">{error}</div>
  }

  if (routes.length === 0) return null

  return (
    <div className="flex flex-col gap-2 p-4 overflow-y-auto max-h-64">
      {routes.map((route) => (
        <RouteCard
          key={route.id}
          route={route}
          selected={route.id === selectedId}
          onSelect={() => onSelect(route.id)}
        />
      ))}
    </div>
  )
}
```

**Step 3: Create AlertBanner component**

Create `src/components/AlertBanner.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { ServiceAlert } from '@/lib/types'

interface AlertBannerProps {
  alerts: ServiceAlert[]
}

export function AlertBanner({ alerts }: AlertBannerProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visible = alerts.filter((a) => !dismissed.has(a.id))
  if (visible.length === 0) return null

  const alert = visible[0]
  const bgColor = alert.severity === 'severe' ? 'bg-red-500' : 'bg-amber-500'

  return (
    <div className={`${bgColor} text-white px-4 py-2 flex items-center justify-between text-sm`}>
      <div>
        <strong>{alert.headerText}</strong>
        {alert.descriptionText && <span className="ml-2 opacity-90">{alert.descriptionText}</span>}
      </div>
      <button
        onClick={() => setDismissed((prev) => new Set(prev).add(alert.id))}
        className="ml-4 text-white opacity-80 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  )
}
```

**Step 4: Wire everything together in page.tsx**

Update `src/app/page.tsx`:

```tsx
'use client'

import { useState, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { SearchPanel } from '@/components/SearchPanel'
import { FilterChips } from '@/components/FilterChips'
import { RouteResults } from '@/components/RouteResults'
import { AlertBanner } from '@/components/AlertBanner'
import { MapView } from '@/components/MapView'
import { TransportMode } from '@/lib/types'
import { ALL_MODES } from '@/lib/constants'
import { useVehicles } from '@/hooks/use-vehicles'
import { useRoutePlan } from '@/hooks/use-route-plan'
import { useAlerts } from '@/hooks/use-alerts'

function AppContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const modesFromUrl = searchParams.get('modes')
  const [activeModes, setActiveModes] = useState<TransportMode[]>(
    modesFromUrl ? (modesFromUrl.split(',') as TransportMode[]) : [...ALL_MODES],
  )
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)

  const vehicleData = useVehicles(activeModes)
  const { routes, loading, error, search } = useRoutePlan()
  const alertData = useAlerts()

  const handleToggle = useCallback(
    (mode: TransportMode) => {
      setActiveModes((prev) => {
        const next = prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
        if (next.length === 0) return prev
        const params = new URLSearchParams(searchParams.toString())
        if (next.length === ALL_MODES.length) {
          params.delete('modes')
        } else {
          params.set('modes', next.join(','))
        }
        router.replace(`?${params.toString()}`, { scroll: false })
        return next
      })
    },
    [searchParams, router],
  )

  const handleSearch = (fromPlace: string, toPlace: string, modes: TransportMode[]) => {
    search(fromPlace, toPlace, modes)
  }

  const selectedRoute = routes.find((r) => r.id === selectedRouteId)
  const selectedGeometry = selectedRoute?.legs
    .map((l) => l.legGeometry?.points)
    .filter(Boolean)
    .join('')

  return (
    <main className="h-dvh flex flex-col">
      {alertData.data?.alerts && <AlertBanner alerts={alertData.data.alerts} />}
      <SearchPanel onSearch={handleSearch} modes={activeModes} />
      <FilterChips activeModes={activeModes} onToggle={handleToggle} />
      <RouteResults
        routes={routes}
        loading={loading}
        error={error}
        selectedId={selectedRouteId}
        onSelect={setSelectedRouteId}
      />
      <MapView
        vehicles={vehicleData.data?.vehicles}
        activeModes={activeModes}
        routeGeometry={selectedGeometry}
      />
    </main>
  )
}

export default function Home() {
  return (
    <Suspense>
      <AppContent />
    </Suspense>
  )
}
```

**Step 5: Verify the full app loads**

Run: `npm run dev`
Expected: Full layout with alert banner (if alerts), search bar, filters, route results area, and live map.

**Step 6: Commit**

```bash
git add src/components/RouteCard.tsx src/components/RouteResults.tsx src/components/AlertBanner.tsx src/app/page.tsx
git commit -m "feat: add route results, alert banner, and wire up full page"
```

---

## Task 14: Error Boundaries

**Files:**

- Create: `src/components/ErrorBoundary.tsx`
- Modify: `src/app/page.tsx`

**Step 1: Create error boundary component**

Create `src/components/ErrorBoundary.tsx`:

```tsx
'use client'

import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught:', error)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}
```

**Step 2: Wrap map and route results in error boundaries**

In `src/app/page.tsx`, wrap `<MapView>` with:

```tsx
<ErrorBoundary fallback={<div className="flex-1 flex items-center justify-center text-gray-500">Map unavailable</div>}>
  <MapView ... />
</ErrorBoundary>
```

And wrap `<RouteResults>` with:

```tsx
<ErrorBoundary fallback={<div className="p-4 text-center text-gray-500">Route search unavailable</div>}>
  <RouteResults ... />
</ErrorBoundary>
```

**Step 3: Commit**

```bash
git add src/components/ErrorBoundary.tsx src/app/page.tsx
git commit -m "feat: add error boundaries for graceful degradation"
```

---

## Task 15: GitHub Actions CI

**Files:**

- Create: `.github/workflows/ci.yml`

**Step 1: Create CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npx tsc --noEmit

      - name: Build
        run: npm run build

      - name: Test
        run: npx jest --passWithNoTests
```

**Step 2: Commit**

```bash
git add .github/
git commit -m "feat: add GitHub Actions CI workflow"
```

---

## Summary

| Task | Description                                                   |
| ---- | ------------------------------------------------------------- |
| 1    | Project scaffolding (Next.js, TypeScript, Tailwind, Prettier) |
| 2    | Docker Compose with OpenTripPlanner + GTFS download           |
| 3    | Shared types and constants                                    |
| 4    | API route — vehicle positions (GPS parser + endpoint)         |
| 5    | API route — route planning (OTP proxy)                        |
| 6    | API route — geocoding (Nominatim proxy)                       |
| 7    | API route — service alerts                                    |
| 8    | Custom hooks (polling, vehicles, route plan, geocode, alerts) |
| 9    | Page layout shell                                             |
| 10   | Search bar with autocomplete                                  |
| 11   | Transport filter chips with URL state                         |
| 12   | Live map with MapLibre + vehicle markers                      |
| 13   | Route results, route cards, alert banner, full page wiring    |
| 14   | Error boundaries                                              |
| 15   | GitHub Actions CI                                             |
