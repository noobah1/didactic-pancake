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
