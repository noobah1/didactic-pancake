# LiveTravely — Estonian Public Transport App

A real-time public transport tracker for Estonia built with Next.js and OpenTripPlanner.

---

## 🚀 Local Development

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js](https://nodejs.org/) (v18+)
- [Git](https://git-scm.com/)

### First Time Setup

```bash
# 1. Clone the repo
git clone https://github.com/noobah1/didactic-pancake.git
cd didactic-pancake

# 2. Install dependencies
npm install

# 3. Download OTP data files (OSM + GTFS) — this takes a few minutes
bash otp/download-data.sh

# 4. Start Docker services (OTP + GTFS updater)
docker compose up -d

# 5. Start the Next.js dev server
npm run dev
```

App runs at **http://localhost:3000**
OTP runs at **http://localhost:8080**

### Daily Development

```bash
# Start everything
docker compose up -d
npm run dev

# Stop everything
docker compose down
```

---

## 🌍 Server Deployment (Linux)

### First Time on a New Server

```bash
# 1. Clone the repo
git clone https://github.com/noobah1/didactic-pancake.git
cd didactic-pancake

# 2. Download data files
bash otp/download-data.sh

# 3. Start all services
docker compose up -d
```

### Updating the Server After a Code Push

```bash
# Pull latest code
git pull origin main

# Restart the app
docker compose restart didacticpancake

# Only needed if build-config.json changed:
bash otp/download-data.sh
docker compose restart otp
```

### If OTP Breaks on the Server

```bash
bash otp/download-data.sh
rm -f otp/graph.obj
docker compose restart otp
docker compose logs -f otp
```

---

## 🔑 Environment Variables

Set in `.env.local` for local development, and in the shell/`.env` Docker Compose reads for deployment.

| Variable | Required | What it does |
|---|---|---|
| `OTP_BASE_URL` | no | OpenTripPlanner endpoint. Defaults to `http://localhost:8080`; compose sets `http://otp:8080`. |
| `TOMTOM_API_KEY` | for city delays | Enables road-speed delay estimates for city bus routes outside Tallinn — see below. Without it that feature is simply off; nothing else changes. |
| `TOMTOM_DAILY_REQUEST_BUDGET` | no | Hard ceiling on TomTom requests per UTC day. Defaults to 2000, under TomTom's ~2500/day free tier. |
| `TRAFFIC_DATA_DIR` / `SHARE_DATA_DIR` | no | Where the SQLite/JSON stores live. Compose sets both to bind-mounted volumes. Defaults to `./traffic-data` and `./share-data`, except `TRAFFIC_DATA_DIR` on Windows — see below. |

> **Never point `TRAFFIC_DATA_DIR` at a cloud-synced folder** (OneDrive,
> Dropbox, iCloud Drive). The sync client rewrites the database underneath
> SQLite's open handle and cross-links its pages, which corrupts it beyond
> what any journal mode can prevent — this happened to the repo's own
> `traffic.db` and is what kept the sampler switched off for a while. On
> Windows the default is therefore `%LOCALAPPDATA%\livetravel	raffic-data`,
> outside any synced tree. The app now runs `PRAGMA quick_check` at startup
> and, on a corrupt file, renames it to `traffic.db.corrupt-<timestamp>` and
> starts a fresh one rather than failing every query forever.

### Where delay information comes from

Not every delay on the board is the same kind of fact, and the app never
presents them as if they were:

- **GPS-confirmed** — a real vehicle's live position measured against its own
  schedule. Available for Tallinn bus/tram/trolleybus/nightbus
  (`transport.tallinn.ee/gps.txt`, Tallinn-only) and for Elron trains
  nationwide. This is the only source that can name a specific vehicle.
- **Estimated from road speed** — "cars on this road are running slower than
  usual," several removes from any specific bus, and always labelled as an
  estimate in the UI. Two feeds: Tark Tee's state-highway detectors for ~251
  intercity/regional routes (free, no key), and TomTom Traffic Flow for city
  bus routes in the top-15 cities (needs `TOMTOM_API_KEY`).

No Estonian city other than Tallinn publishes live vehicle positions — the
national journey planner (api.peatus.ee, a Digitransit/OTP deployment) returns
`"realtime": false` for every departure in the country, and Transitous lists
exactly one GTFS-RT source for Estonia (Elron's). The TomTom path exists
because road speed is the only signal that reaches a city bus in Tartu, Narva
or Pärnu at all.

City probe points are generated, not hand-written. After a GTFS graph rebuild:

```bash
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/generate-city-probes.ts
```

---

## 📦 GitHub Rules — Read Before Committing!

- ✅ Only commit code files
- ❌ Never commit files in `otp/data/` (GTFS zips, OSM files)
- ❌ Never commit `otp/graph.obj`
- ❌ Never commit `.exe` files
- ❌ Never commit `docker-compose.yml` — use `compose.yaml` only
- GitHub file size limit is **100MB** — data files are all in `.gitignore`

### Safe Commit Workflow

```bash
git add .
git commit -m "your message"
git push origin main
```

If push fails with a large file error:
```bash
git filter-repo --path "path/to/large/file" --invert-paths --force
git remote add origin https://github.com/noobah1/didactic-pancake.git
git push origin main --force
```

---

## 🗂️ Project Structure

```
didactic-pancake/
├── src/
│   ├── app/
│   │   ├── api/          # Next.js API routes
│   │   └── page.tsx      # Main page
│   ├── components/       # React components
│   └── lib/              # Utilities and constants
├── otp/
│   ├── build-config.json # OTP build configuration
│   ├── router-config.json
│   ├── download-data.sh  # Script to download GTFS + OSM data
│   └── data/             # Data files (gitignored)
├── compose.yaml          # Docker services
└── Dockerfile
```

---

## 🐳 Docker Services

| Service | Description | Port |
|---------|-------------|------|
| `didacticpancake` | Next.js app | 3000 |
| `otp` | OpenTripPlanner routing engine | 8080 |
| `gtfs-updater` | Downloads fresh GTFS data every 24h | — |

---

## ❓ Troubleshooting

**OTP not starting / "no-fare" error**
```bash
# Check logs
docker compose logs otp

# Fix: edit otp/build-config.json and remove the "fares" block
docker compose restart otp
```

**"No routes found" in the app**
```bash
# OTP doesn't have data yet — download and rebuild
bash otp/download-data.sh
rm -f otp/graph.obj
docker compose restart otp
```

**App API returning 404**
```bash
# Make sure Next.js dev server is running
npm run dev
```

**Multiple compose file warning**
```bash
# Delete the old file — only compose.yaml should exist
rm docker-compose.yml
```
