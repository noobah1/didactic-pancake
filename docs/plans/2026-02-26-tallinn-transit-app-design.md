# Tallinn Public Transit App — Design Document

## Overview

A web-based public transport app for Tallinn that helps people get from A to B as fast and conveniently as possible. Skyscanner-style search UI with a persistent live map showing real-time vehicle positions. Open-source community project.

**Scope:** Tallinn first, expandable to other cities and countries later.

## Architecture

```
┌─────────────────────────────────────────────┐
│              Next.js Web App                 │
│  ┌────────────────┐  ┌───────────────────┐  │
│  │  Route Planner  │  │   Live Map        │  │
│  │  (Skyscanner    │  │   (MapLibre GL)   │  │
│  │   style UI)     │  │   - vehicle dots  │  │
│  │                 │  │   - route lines   │  │
│  └───────┬────────┘  └────────┬──────────┘  │
│          │                    │              │
│  ┌───────┴────────────────────┴──────────┐  │
│  │        Next.js API Routes / Edge       │  │
│  │  - proxy GTFS-RT feeds (avoid CORS)    │  │
│  │  - cache responses (~10-30s TTL)       │  │
│  │  - service alerts endpoint             │  │
│  └───────┬────────────────────┬──────────┘  │
└──────────┼────────────────────┼──────────────┘
           │                    │
   ┌───────▼────────┐  ┌───────▼──────────┐
   │ OpenTripPlanner │  │  GTFS-Realtime   │
   │   (self-hosted) │  │  Feeds (TLT,     │
   │  - route search │  │   Elron, etc.)   │
   │  - loaded with  │  │  - vehicle pos   │
   │    GTFS data    │  │  - trip updates  │
   └────────────────┘  │  - service alerts │
                        └──────────────────┘
```

**Key components:**
- **Next.js app** — serves the UI and acts as a thin API proxy
- **OpenTripPlanner 2** — self-hosted, loaded with Tallinn GTFS data, handles all route planning
- **GTFS-Realtime feeds** — polled via Next.js API routes for live vehicle positions, delays, and service alerts
- **MapLibre GL JS** — open-source map rendering with live vehicle markers

No database needed for v1. OTP has its own routing graph, and real-time data is fetched fresh.

## User Interface

Single-page layout with two zones:

```
┌─────────────────────────────────────┐
│  Search Bar (always visible)        │
│  [From: current location / type]    │
│  [To: type destination]             │
│  [Depart now ▼] [Search]            │
├─────────────────────────────────────┤
│  Filters (toggle chips):            │
│  [Bus ✓] [Tram ✓] [Trolley ✓]      │
│  [Train ✓] [Ferry ✓]               │
├─────────────────────────────────────┤
│  Route Results (scrollable)         │
│  - Transport icons, total time      │
│  - Departure time, live delay badge │
│  - Tap to highlight on map          │
├─────────────────────────────────────┤
│  Live Map (persistent bottom half)  │
│  - Vehicle dots moving in realtime  │
│  - Selected route highlighted       │
│  - Tap stop for departures          │
└─────────────────────────────────────┘
```

**Key interactions:**
- **Search:** Type origin/destination with autocomplete (stop names + addresses via Nominatim). Default origin is user's GPS location.
- **Filters:** Toggle chips for each transport type (bus, tram, trolleybus, train, ferry). All on by default. Applies to both route results and map vehicles.
- **Route results:** Sorted by fastest. Each card shows transport types, total time, departure time, and live delay status. Tapping highlights the route on the map.
- **Live map:** All vehicles as colored dots by transport type. Updates every 5-10 seconds. Tap stop for departures, tap vehicle for route info.
- **Service alerts:** Dismissible banner at top for active disruptions. Color-coded: yellow for delays, red for cancellations.
- **Responsive:** Works on mobile browsers (touch-friendly) and desktop. Route results panel is collapsible so map can go full-screen.
- **Filter state** persists in URL query params for sharing/bookmarking.

## Data & Real-time Updates

**GTFS Static Data (schedules):**
- Loaded into OpenTripPlanner on startup
- Sources: TLT (bus, tram, trolleybus), Elron (trains), ferry operators
- OTP rebuilds its routing graph when GTFS data is updated (typically weekly)

**GTFS-Realtime Feeds (live data):**
- **Vehicle Positions** — lat/lng of each vehicle, polled every 5-10s, pushed to map
- **Trip Updates** — delay predictions per stop, merged into route results
- **Service Alerts** — disruptions, cancellations, detours, shown as banners

**Polling strategy:**
- Foreground: vehicle positions every 5-10s, trip updates every 30s, alerts every 60s
- Backgrounded tab: stop polling to save resources
- Simple polling — no WebSockets needed for v1

**Geocoding:**
- Nominatim (open-source, OSM-based) for address autocomplete
- Stop name search from GTFS stops data in OTP

## Error Handling & Reliability

- **Network failures:** Show last known vehicle positions with "Last updated X seconds ago" indicator. Clear error message if OTP is unreachable. Fall back to stop-name-only search if geocoding fails.
- **Stale data:** Vehicle dots not updated in >60s get dimmed. Delay badges show "live" vs "scheduled" freshness.
- **Service disruptions:** Color-coded alert banners. Disruptions affecting selected route are highlighted on result cards.
- **App stability:** React error boundaries around map and route results. Graceful degradation — if map fails, results still work and vice versa.

## Tech Stack

**Frontend:**
- Next.js 14+ (App Router)
- TypeScript
- MapLibre GL JS (open-source maps)
- OpenStreetMap tiles

**Backend (minimal):**
- Next.js API Routes — proxy for GTFS-RT, caching, CORS
- OpenTripPlanner 2 — self-hosted, Docker, loaded with GTFS data

**Infrastructure:**
- Docker Compose (OTP + Next.js)
- Single VPS deployment (Hetzner / DigitalOcean)
- No database, no auth, no paid APIs

**Dev tooling:**
- ESLint + Prettier
- GitHub for source control
- GitHub Actions for CI (lint, build check)

## Transport Types Covered

- Bus (TLT)
- Tram (TLT)
- Trolleybus (TLT)
- Commuter/regional trains (Elron)
- Ferries

## Future Expansion

- Additional Estonian cities
- Cross-city / intercity routing
- Other countries
- Optional user accounts for saved routes/preferences
- Mobile app (React Native or PWA)
