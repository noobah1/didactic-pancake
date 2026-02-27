# Live Incidents Map Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a floating warning button on the map that toggles incident overlays (affected route lines + warning markers with popups) using existing OTP alert data.

**Architecture:** A new `IncidentButton` component floats over the map. When toggled, `MapView` fetches route shapes for each alert's `affectedRoutes` via the existing `/api/route-shape` endpoint, then renders colored GeoJSON line layers and HTML warning markers with popups on the MapLibre GL map. All alert data comes from the existing `useAlerts` hook (60s polling).

**Tech Stack:** React 19, Next.js 16, MapLibre GL, Tailwind v4, lucide-react (new)

---

### Task 1: Install lucide-react

**Files:**
- Modify: `package.json`

**Step 1: Install the package**

Run: `npm install lucide-react`

**Step 2: Verify installation**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add lucide-react icon library"
```

---

### Task 2: Create IncidentButton component

**Files:**
- Create: `src/components/IncidentButton.tsx`

**Step 1: Create the component**

The button is a floating circle positioned on the right side of the map. It uses the Lucide `AlertTriangle` icon with yellow fill and red outline (per user request). Shows a badge with the count of active alerts.

```tsx
'use client'

import { AlertTriangle } from 'lucide-react'

interface IncidentButtonProps {
  active: boolean
  alertCount: number
  onClick: () => void
}

export function IncidentButton({ active, alertCount, onClick }: IncidentButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`absolute right-3 top-28 z-10 w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all border-2 ${
        active
          ? 'bg-amber-100 border-red-500'
          : 'bg-white/90 border-gray-300 hover:bg-gray-100'
      }`}
      title={active ? 'Hide incidents' : `Show incidents (${alertCount})`}
    >
      <AlertTriangle
        size={20}
        fill={alertCount > 0 ? '#FBBF24' : 'none'}
        stroke={alertCount > 0 ? '#EF4444' : '#9CA3AF'}
        strokeWidth={2}
      />
      {alertCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
          {alertCount > 9 ? '9+' : alertCount}
        </span>
      )}
    </button>
  )
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/IncidentButton.tsx
git commit -m "feat: add IncidentButton component with warning triangle icon"
```

---

### Task 3: Wire up state in page.tsx and pass alerts to MapView

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Add showIncidents state and render IncidentButton inside the map container**

Changes to `page.tsx`:
1. Import `IncidentButton`
2. Add `const [showIncidents, setShowIncidents] = useState(false)` state
3. Filter alerts to only warning/severe (skip info)
4. Pass `showIncidents`, `alerts`, and the button as children or alongside MapView

The `IncidentButton` must be positioned absolutely inside a `relative` container that wraps the map. The simplest approach: wrap the MapView `ErrorBoundary` in a `div className="flex-1 relative"` and render `IncidentButton` as a sibling inside that wrapper.

Update the MapView props to accept `alerts` and `showIncidents`.

```tsx
// Add imports at top:
import { IncidentButton } from '@/components/IncidentButton'
import { ServiceAlert } from '@/lib/types'

// Add state after selectedRouteId:
const [showIncidents, setShowIncidents] = useState(false)

// Compute filtered alerts (skip 'info' severity):
const activeAlerts = (alertData.data?.alerts || []).filter(
  (a) => a.severity !== 'info' && a.affectedRoutes.length > 0,
)

// Replace the MapView ErrorBoundary section with:
<div className="flex-1 relative">
  <ErrorBoundary
    fallback={
      <div className="flex-1 flex items-center justify-center text-gray-500">
        Map unavailable
      </div>
    }
  >
    <MapView
      vehicles={vehicleData.data?.vehicles}
      activeModes={activeModes}
      selectedRoute={selectedRoute}
      incidents={showIncidents ? activeAlerts : undefined}
    />
  </ErrorBoundary>
  <IncidentButton
    active={showIncidents}
    alertCount={activeAlerts.length}
    onClick={() => setShowIncidents((prev) => !prev)}
  />
</div>
```

**Step 2: Verify it compiles** (MapView will show a type error for the new `incidents` prop — that's expected, we'll fix it in Task 4)

**Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: wire up incidents toggle state and button in page layout"
```

---

### Task 4: Add incident overlay rendering to MapView

**Files:**
- Modify: `src/components/MapView.tsx`

This is the main task. When `incidents` prop is provided (non-empty array), MapView:
1. Fetches route shapes for each alert's `affectedRoutes` via `/api/route-shape`
2. Draws colored line layers on the map (red for severe, amber for warning)
3. Places HTML warning markers at midpoints of affected routes with popups showing alert info
4. Cleans up all layers/markers when `incidents` becomes undefined

**Step 1: Update MapViewProps interface and add constants**

```tsx
// Add to imports:
import { VehiclePosition, TransportMode, RouteResult, ServiceAlert } from '@/lib/types'

// Add constants after existing layer constants:
const INCIDENT_LINE_PREFIX = 'incident-line-'
const INCIDENT_SOURCE_PREFIX = 'incident-src-'

// Update interface:
interface MapViewProps {
  vehicles?: VehiclePosition[]
  activeModes?: TransportMode[]
  selectedRoute?: RouteResult | null
  incidents?: ServiceAlert[]
  onStopClick?: (stopId: string) => void
}
```

**Step 2: Update component signature to accept incidents**

```tsx
export function MapView({ vehicles, activeModes = [], selectedRoute, incidents }: MapViewProps) {
```

**Step 3: Add refs for incident layers and markers**

After `mapReadyRef`:
```tsx
const incidentLayerIdsRef = useRef<string[]>([])
const incidentMarkersRef = useRef<maplibregl.Marker[]>([])
```

**Step 4: Add the incident overlay useEffect**

Add a new `useEffect` after the "Draw planned route" effect (before the return statement). This effect:
- Cleans up previous incident layers/markers
- If `incidents` is undefined or empty, just cleans up
- Otherwise, fetches route shapes for each affected route and renders them

```tsx
// Incident overlay effect
useEffect(() => {
  const map = mapRef.current
  if (!map) return

  const cleanup = () => {
    for (const id of incidentLayerIdsRef.current) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    // Remove sources (derive source id from layer id)
    for (const id of incidentLayerIdsRef.current) {
      const srcId = id.replace(INCIDENT_LINE_PREFIX, INCIDENT_SOURCE_PREFIX)
      if (map.getSource(srcId)) map.removeSource(srcId)
    }
    incidentLayerIdsRef.current = []
    incidentMarkersRef.current.forEach((m) => m.remove())
    incidentMarkersRef.current = []
  }

  const draw = async () => {
    cleanup()
    if (!incidents || incidents.length === 0 || !mapReadyRef.current) return

    const layerIds: string[] = []
    let routeIndex = 0

    for (const alert of incidents) {
      const color = alert.severity === 'severe' ? '#EF4444' : '#D97706'

      for (const routeName of alert.affectedRoutes) {
        try {
          // Try each mode to find the route shape
          let shapeData: { patterns: RouteShapePattern[] } | null = null
          for (const mode of ['bus', 'tram', 'train', 'ferry']) {
            const res = await fetch(
              `/api/route-shape?line=${encodeURIComponent(routeName)}&mode=${mode}`,
            )
            if (res.ok) {
              const data = await res.json()
              if (data.patterns?.length) {
                shapeData = data
                break
              }
            }
          }

          if (!shapeData?.patterns?.length) continue

          // Draw lines for each pattern
          for (const pattern of shapeData.patterns) {
            const coords = decodePolyline(pattern.geometry)
            if (coords.length < 2) continue

            const srcId = `${INCIDENT_SOURCE_PREFIX}${routeIndex}`
            const layerId = `${INCIDENT_LINE_PREFIX}${routeIndex}`

            const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: coords },
            }

            map.addSource(srcId, { type: 'geojson', data: geojson })
            map.addLayer({
              id: layerId,
              type: 'line',
              source: srcId,
              paint: {
                'line-color': color,
                'line-width': 6,
                'line-opacity': 0.7,
              },
              layout: { 'line-join': 'round', 'line-cap': 'round' },
            })

            layerIds.push(layerId)

            // Place a warning marker at the midpoint of the first pattern
            if (routeIndex === layerIds.length - 1) {
              const mid = coords[Math.floor(coords.length / 2)]
              const el = document.createElement('div')
              el.style.width = '28px'
              el.style.height = '28px'
              el.style.borderRadius = '50%'
              el.style.backgroundColor = alert.severity === 'severe' ? '#FEE2E2' : '#FEF3C7'
              el.style.border = `2px solid ${color}`
              el.style.display = 'flex'
              el.style.alignItems = 'center'
              el.style.justifyContent = 'center'
              el.style.cursor = 'pointer'
              el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)'
              el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#FBBF24" stroke="#EF4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`

              const popup = new maplibregl.Popup({ offset: 15, maxWidth: '250px' }).setHTML(
                `<div style="padding:4px"><strong style="color:${color}">${alert.headerText}</strong>${alert.descriptionText ? `<p style="margin:4px 0 0;font-size:13px;color:#374151">${alert.descriptionText}</p>` : ''}<p style="margin:4px 0 0;font-size:11px;color:#6B7280">Affected: ${routeName}</p></div>`,
              )

              const marker = new maplibregl.Marker({ element: el })
                .setLngLat(mid as [number, number])
                .setPopup(popup)
                .addTo(map)

              incidentMarkersRef.current.push(marker)
            }

            routeIndex++
          }
        } catch {
          // Skip routes we can't fetch shapes for
        }
      }
    }

    incidentLayerIdsRef.current = layerIds
  }

  if (mapReadyRef.current) {
    draw()
  } else {
    map.once('load', () => draw())
  }

  return cleanup
}, [incidents])
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Run existing tests**

Run: `npx jest`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/components/MapView.tsx
git commit -m "feat: add incident overlay rendering with route lines and warning markers"
```

---

### Task 5: Final integration test and commit

**Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run all tests**

Run: `npx jest`
Expected: All pass

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Final commit (if any uncommitted changes remain)**

```bash
git add -A
git commit -m "feat: complete live incidents overlay feature"
```
