# LiveTravel

Public transport route planner for Estonia. Find the fastest route using buses, trams, trolleybuses, trains, and ferries — with live vehicle positions on the map.

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Docker](https://www.docker.com/) and Docker Compose
- ~2 GB free disk space (for GTFS data and OTP graph)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Download GTFS data

This downloads the Estonian public transport schedule data from peatus.ee:

```bash
./scripts/download-gtfs.sh
```

### 3. Build the OpenTripPlanner routing graph

This processes the GTFS data into a routing graph. Takes a few minutes on first run:

```bash
docker compose run --rm otp --build --save
```

### 4. Start OpenTripPlanner

```bash
docker compose up -d otp
```

Wait ~30 seconds for OTP to load the graph. Verify it's running:

```bash
curl http://localhost:8080/otp/routers/default/index/routes | head -c 200
```

You should see a JSON array of route objects.

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Type a starting location in the "From" field (uses OpenStreetMap geocoding)
2. Type a destination in the "To" field
3. Click "Search routes" to get route options
4. Use the filter chips to show/hide transport types (Bus, Tram, Trolleybus, Train, Ferry)
5. Click a route result to highlight it on the map
6. The map shows live vehicle positions, updated every few seconds

## Project Structure

```
src/
  app/
    api/
      alerts/       — service alerts proxy (OTP)
      geocode/      — address search proxy (Nominatim)
      plan/         — route planning proxy (OTP)
      vehicles/     — live vehicle positions (transport.tallinn.ee)
    page.tsx        — main page (search + map layout)
    layout.tsx      — root layout
  components/
    AlertBanner.tsx   — service disruption alerts
    ErrorBoundary.tsx — graceful degradation wrapper
    FilterChips.tsx   — transport mode toggle filters
    LocationInput.tsx — address input with autocomplete
    MapView.tsx       — MapLibre GL live map
    RouteCard.tsx     — single route result card
    RouteResults.tsx  — scrollable route results list
    SearchPanel.tsx   — search form (from/to + button)
  hooks/
    use-alerts.ts     — polls service alerts
    use-geocode.ts    — debounced address search
    use-polling.ts    — generic polling utility
    use-route-plan.ts — on-demand route search
    use-vehicles.ts   — polls live vehicle positions
  lib/
    constants.ts      — URLs, map defaults, mode colors
    parse-gps.ts      — Tallinn GPS feed parser
    types.ts          — shared TypeScript interfaces
otp/                  — OpenTripPlanner configuration
scripts/              — setup scripts
docker-compose.yml    — OTP service definition
```

## Tech Stack

- **Frontend:** Next.js 16, TypeScript, Tailwind CSS v4, MapLibre GL JS
- **Routing engine:** OpenTripPlanner 2 (self-hosted via Docker)
- **Data:** GTFS static schedules (peatus.ee), live GPS feed (transport.tallinn.ee), Nominatim geocoding
- **CI:** GitHub Actions (lint, type check, build, test)

## Scripts

| Command            | Description              |
| ------------------ | ------------------------ |
| `npm run dev`      | Start development server |
| `npm run build`    | Production build         |
| `npm run lint`     | Run ESLint               |
| `npx tsc --noEmit` | Type check               |
| `npx jest`         | Run tests                |

## License

Open source — contributions welcome.
