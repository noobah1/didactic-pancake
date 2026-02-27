# Live Incidents Map Overlay - Design

## Overview

Add a floating toggle button on the right side of the map that, when activated, overlays live transit incidents onto the map using existing OTP alert data.

## Icon Library

Install `lucide-react`. Provides `AlertTriangle`, `Filter`, `Search` and 1000+ tree-shakeable icons (~1KB each).

## Toggle Button

- Floating button on the right side of the map (below zoom controls area)
- Icon: Lucide `AlertTriangle` — yellow fill with red outline
- Inactive state: semi-transparent background
- Active state: solid background, highlighted
- Badge count showing number of active alerts

## Map Overlays (when toggled ON)

### Affected Route Lines
- Fetch route shapes via existing `/api/route-shape` endpoint for each alert's `affectedRoutes`
- Draw as thick colored lines over the map
- Severe alerts: red lines (`#EF4444`)
- Warning alerts: dark amber lines (`#D97706`)
- Info-level alerts: not shown on map (too minor)

### Warning Circle Markers
- Placed at midpoints of affected route segments
- Pulsing amber/red circle with `AlertTriangle` icon inside
- Tap/click shows a popup with alert header and description

## Data Flow

1. Existing `useAlerts` hook (polls every 60s) provides alert data
2. New state `showIncidents` toggled by the button
3. When active, fetch route shapes for alerts that have `affectedRoutes`
4. Render GeoJSON layers on MapLibre GL map
5. Clean up layers when toggled off

## Severity Colors

| Severity | Line Color | Marker Color |
|----------|-----------|--------------|
| severe   | #EF4444   | Red          |
| warning  | #D97706   | Amber        |
| info     | —         | Not shown    |

## Components Modified/Created

- **New**: `IncidentButton.tsx` — floating toggle button
- **Modified**: `MapView.tsx` — add incident overlay layers + popups
- **Modified**: `page.tsx` — add `showIncidents` state, pass to MapView
- **Modified**: `package.json` — add `lucide-react`
