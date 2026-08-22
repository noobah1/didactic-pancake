# LiveTravely — Architecture & Code Map

A real-time public transport tracker for **all of Estonia**, built on Next.js + OpenTripPlanner.

> This document explains **how the app is put together and why**.
> For install, deployment, environment variables and troubleshooting, see [`README.md`](README.md).

---

## 1. What the app is

One fullscreen MapLibre map with floating panels. A rider can:

| | Feature | Entry point |
|---|---|---|
| 🔍 | Plan a journey A → B (address or stop) | `SearchPanel.tsx` → `/api/plan` |
| 🚌 | Watch live vehicles move on the map | `MapView.tsx` → `/api/vehicles` |
| ⏱️ | See a single trip's stop-by-stop timetable, ETA and platform | `TimetablePanel.tsx` → `/api/trip-stops` |
| 🚏 | Check departures at a stop, or the stops near them | `StopBoard.tsx` / `NearbyPanel.tsx` |
| ⚠️ | See city-wide delays, slow roads and service alerts | `IssuesPanel.tsx` → `/api/delays`, `/api/alerts` |
| 🔗 | Share a live journey with someone | `RouteResults.tsx` → `/api/share` |
| ⭐ | Save favourite routes | `FavoriteChip.tsx`, `use-favorites.ts` |

There is **no `/journey` route** — the entire app is `src/app/page.tsx` (~756 lines),
a client component wrapped in `<Suspense>`. State lives in React, not in the URL.

---

## 2. System overview

```
                    ┌──────────────────────────────────────┐
                    │        Browser (PWA)                 │
                    │  page.tsx · MapLibre GL · panels     │
                    │  public/sw.js (shell cache only)     │
                    └───────────────┬──────────────────────┘
                                    │ fetch /api/*
                    ┌───────────────▼──────────────────────┐
                    │      Next.js 16 (App Router)         │
                    │  10 API routes · in-process caches   │
                    │  SQLite (node:sqlite) · JSON stores  │
                    └───┬──────────────┬───────────────┬───┘
                        │              │               │
              ┌─────────▼───┐   ┌──────▼──────┐  ┌─────▼──────────┐
              │ OTP 2.6.0   │   │ GTFS-RT /   │  │ Traffic feeds  │
              │ GraphQL     │   │ GPS feeds   │  │ Tark Tee       │
              │ :8080       │   │ Tallinn,    │  │ TomTom         │
              │ (Docker)    │   │ Elron       │  │ (optional key) │
              └─────────────┘   └─────────────┘  └────────────────┘
```

The browser **never** talks to an upstream feed directly — every external call is proxied
through an API route, which handles CORS, timeouts, caching and the request budget.

---

## 3. The defining idea: delay evidence is tiered

This is the single most important convention in the codebase. Estonia has almost no
real-time transit data, so the app assembles delay information from sources of very
different quality — **and never lets them blur together**.

| Tier | Meaning | Source | Type |
|---|---|---|---|
| **GPS-confirmed** | A named vehicle's live position vs. its own schedule | `transport.tallinn.ee/gps.txt` (Tallinn only), Elron GTFS-RT (trains, nationwide) | `DelayedVehicle`, `TripStopInfo.delaySeconds` |
| **Schedule-interpolated** | Where a vehicle *should* be right now | OTP static timetable | `VehiclePosition.estimated: true` |
| **Road-speed estimate** | "Cars on this road are slower than usual" — several removes from any specific bus | Tark Tee highway detectors (~251 routes), TomTom Traffic Flow (city buses) | `TrafficEstimate` / `RouteTrafficEstimate` |

Enforced by three rules that every contributor must keep:

1. **`delaySeconds` absent means *no live evidence*, never zero.**
   `src/lib/types.ts` states this twice. Do not default it, do not coalesce it to `0`.
2. **`TrafficEstimate` carries `evidence: 'traffic-estimate'`** so it can never be
   mistaken for a GPS delay by field-shape alone. It is never merged into
   `DelayedVehicle.delaySeconds`.
3. **Never guess a platform.** `LegPlace.platform` / `TripStopInfo.platform` exist only
   for Elron trains, matched against Elron's own live-map board
   (`src/lib/elron-platform.ts`). Absent means absent.

A fourth tier exists for *people* rather than vehicles: `TravellerSource` =
`'gps' | 'vehicle' | 'schedule' | 'stale'` (`src/lib/traveller-position.ts`), so a
shared journey can never render an inferred guess with the same visual weight as a
real fix.

---

## 4. API routes

All under `src/app/api/`. Every one is a `GET` unless noted.

| Route | Does | Notable |
|---|---|---|
| `plan` | Journey planning | → `lib/plan-query.ts` → OTP GraphQL. Returns `RouteResult[]`. Supports banned trips for "get alternatives". |
| `delays` | The delay engine | Merges Tallinn GPS + Elron GTFS-RT against the static schedule. Returns `{ vehicles, estimates, timestamp, availability }`. 8s result cache. |
| `vehicles` | Live vehicle positions for the map | Real GPS where it exists, timetable-interpolated otherwise (`estimated: true`). |
| `trip-stops` | One trip's full stop list | Two lookup modes: by `tripId`, or by line + mode + destination + position + heading. RAIL results go through `enrichTrainPlatforms()`. |
| `stop-board` | Departures at a stop | 20s server cache, matching `POLL_INTERVALS.stopBoard`. Serves stale on upstream error. |
| `nearby-stops` | Stops around a coordinate | Widens 600 m → 8 km when fewer than 3 usable stops. |
| `alerts` | Service alerts | OTP alerts + Tark Tee road disruptions. |
| `geocode` | Address + stop search | Nominatim + OTP stop index, with reserved slots so addresses stay reachable. |
| `route-shape` | Encoded polyline for a route | |
| `share` | Live journey sharing | `POST` create · `GET` read · `PATCH` push position · `DELETE` stop. Hashed owner token. |

---

## 5. Frontend structure

### Page

`src/app/page.tsx` owns all journey state: search inputs, plan results, `selectedRouteId`,
panel visibility, and the derived `journeyVehicles` (each non-walk leg matched to a live
vehicle by `tripId`, then by the schedule feed, then by `findVehicleForLeg()` position +
heading fallback).

`src/app/layout.tsx` sets PWA metadata and runs a **blocking inline script** that applies
the OS dark-mode preference before first paint, so there is no flash of the wrong theme.

### Components (`src/components/`)

- **`MapView.tsx`** (1525 L) — the big one. MapLibre GL: vehicle markers, route lines,
  traveller marker, stop pins.
- **`SearchPanel.tsx`** / **`LocationInput.tsx`** / **`CitySelector.tsx`** — search UI.
- **`RouteResults.tsx`** — drag-resizable bottom sheet (25–88 vh); **`RouteCard.tsx`** per itinerary.
- **`TimetablePanel.tsx`** — single-trip stop list, ETA, `Pl {platform}` badge (amber when
  `platformChanged`), `NOW` marker.
- **`IssuesPanel.tsx`** / **`IssuesButton.tsx`** — city-wide issues, *not* journey-scoped.
- **`DelayBanner.tsx`** / **`DelayToast.tsx`** — journey-scoped delay surfacing.
- **`StopBoard.tsx`**, **`NearbyPanel.tsx`**, **`NearbyButton.tsx`**, **`FavoriteChip.tsx`**,
  **`ErrorBoundary.tsx`**, **`ServiceWorkerRegistration.tsx`**.

### Hooks (`src/hooks/`)

| Hook | Role |
|---|---|
| `use-route-plan` | Runs `/api/plan`; persists to `localStorage` (`route-plan-state`) with a **6-hour** expiry so a mid-trip refresh restores the journey |
| `use-polling` | Shared interval primitive; all intervals come from `POLL_INTERVALS` |
| `use-delays` / `use-vehicles` / `use-alerts` / `use-stop-board` / `use-nearby-stops` | Feed pollers |
| `use-journey-monitor` | Emits `DelayWarning[]` for legs still in the future, above `LIVE_BANNER_THRESHOLD_SEC` (60 s) |
| `use-delay-toast` | Toasts, scoped to the *selected* route's trip IDs only |
| `use-live-share` | `watchPosition` → `PATCH /api/share`, throttled to 15 s, flushed with `keepalive` on `pagehide` |
| `use-wake-lock` | Holds the screen awake during sharing — `watchPosition` dies seconds after screen lock |
| `use-geolocation`, `use-geocode`, `use-favorites`, `use-theme` | Supporting |

---

## 6. Library modules (`src/lib/`)

- **`delay.ts`** (722 L) — the matching engine. `findVehicleForLeg()`, thresholds:
  `LATE_BUFFER_SEC 59`, `LIVE_BANNER_THRESHOLD_SEC 60`, `OVERVIEW_THRESHOLD_SEC 180`,
  `MAX_MATCH_DISTANCE_M 800`, `TRIP_CONTINUITY_BONUS 3000`.
- **`plan-query.ts`** — OTP GraphQL journey planning.
- **`constants.ts`** — feed URLs, 28 cities across 15 counties, poll intervals, mode
  colours/labels, GTFS agency IDs. Densely commented with *live-verified* findings; read
  the comments before changing a number.
- **`elron.ts` / `elron-platform.ts`** — Elron GTFS-RT and the undocumented live-map
  platform board (needs a real `User-Agent`; Cloudflare 403s otherwise).
- **`stop-search.ts`**, **`nearby-stops.ts`**, **`traveller-position.ts`**,
  **`parse-gps.ts`**, **`service-date.ts`**, **`decode-polyline.ts`**, **`feed-status.ts`**.
- **`traffic/`** — the road-speed subsystem: `detectors.ts` (Tark Tee), `tomtom.ts`,
  `baseline.ts` (learned per-detector normal speed), `estimate.ts`, `city-estimate.ts`,
  `sampler.ts`, plus generated `detector-sites.json`, `route-coverage.json`,
  `city-probes.json`.
- **`db.ts`** — SQLite via `node:sqlite`. `PRAGMA journal_mode = DELETE` deliberately:
  WAL breaks on OneDrive/network filesystems.
- **`share-store.ts`** — one JSON file per share; position TTL 3 h, share TTL 30 days.

---

## 7. Caching & polling

| Layer | Policy |
|---|---|
| Service worker | Shell + static assets only. **`/api/*` is never intercepted** — live data must always be fresh. Navigations are network-first. |
| Client polling | `POLL_INTERVALS`: vehicles 7 s · delays 20 s · stop board 20 s · nearby 20 s · alerts 60 s |
| Server caches | Delays 8 s · Elron platforms 60 s · Tark Tee detectors 60 s · TomTom flow 10 min |
| Budgets | TomTom hard-capped at `TOMTOM_DAILY_REQUEST_BUDGET` (default 2000/UTC day), max 40 probe refreshes per cycle |
| Staleness | A detector reading older than `MAX_READING_AGE_MS` (20 min) stops counting entirely rather than silently speaking for current conditions |

---

## 8. Persistence

| What | Where | Survives redeploy |
|---|---|---|
| Traffic baselines | SQLite at `TRAFFIC_DATA_DIR/traffic.db` | ✅ bind-mounted (takes days to relearn) |
| Live shares | JSON at `SHARE_DATA_DIR` | ✅ bind-mounted |
| Delays / vehicles / alerts caches | In-process | ❌ by design |
| Favourites, last plan, theme | Browser `localStorage` | n/a |

---

## 9. Testing

`npm test` — Jest 30 + ts-jest. Seven suites in `src/lib/__tests__/`: `delay`,
`elron-platform`, `feed-status`, `nearby-stops`, `parse-gps`, `stop-search`,
`traveller-position`. Tests target pure library logic; there is no component or
end-to-end layer. `TRAFFIC_DB_PATH=":memory:"` swaps the SQLite file out for tests.

---

## 10. Deployment

Two Docker services in `compose.yaml`: `didacticpancake` (host **3001** → 3000) and `otp`
(2.6.0, `-Xmx2g`, healthchecked). CI/CD is `.github/workflows/deploy.yml` — a push to
`main` SSHes to a self-hosted Linux box and runs `scripts/deploy.sh`.
`build-otp-graph.yml` rebuilds the GTFS/OSM graph nightly.

Next.js is configured `output: 'standalone'` with a rewrite proxying `/otp/:path*` to the
OTP container.

---

## 11. Known limits

- **Live vehicle positions exist only for Tallinn and Elron trains.** No other Estonian
  city publishes them — `api.peatus.ee` reports `"realtime": false` nationwide, and
  Transitous lists exactly one GTFS-RT source for the country. The TomTom path exists
  because road speed is the only signal that reaches a bus in Tartu, Narva or Pärnu.
- **No background tracking.** As a PWA the app cannot run when backgrounded;
  `use-live-share.ts` and `use-wake-lock.ts` both document this ceiling. Lock-screen /
  Dynamic Island journey status would require a native shell.
- **Push notifications were removed** in commit `41111e0` (VAPID vars were never set in
  the deployment, so the checker no-oped from boot). `computeDelays()` and `planTrip()`
  remain exported for any future re-implementation.
- `elron.zip` in the OTP graph is committed once and drifts stale; the unified national
  feed's copy of the Elron schedule is the one kept current.

---

## 12. Where to start

| Task | Files |
|---|---|
| Change how a delay is calculated or matched | `src/lib/delay.ts`, `src/app/api/delays/route.ts` |
| Add a map layer or marker | `src/components/MapView.tsx` |
| Change the journey results UI | `src/components/RouteResults.tsx`, `RouteCard.tsx` |
| Change ETA / platform display | `src/components/TimetablePanel.tsx` |
| Add a city | `CITIES` in `src/lib/constants.ts`, then regenerate `city-probes.json` |
| Add an upstream feed | New `src/lib/<feed>.ts` + a proxying API route — never call it from the browser |
| Tune polling or caching | `POLL_INTERVALS` and the per-route TTL constants |
