#!/bin/bash
set -e

parent_path=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )
cd "$parent_path"

DATA_DIR="./data/"
GTFS_URL="https://eu-gtfs.remix.com/estonia_unified_gtfs.zip"
OSM_URL="https://download.geofabrik.de/europe/estonia-latest.osm.pbf"

echo "$(date) — Downloading GTFS data..."
curl -L -o "$DATA_DIR/estonia_unified_gtfs.zip" "$GTFS_URL"
echo "$(date) — GTFS download complete"

echo "$(date) — Downloading OSM data..."
curl -L -o "$DATA_DIR/estonia-latest.osm.pbf" "$OSM_URL"
echo "$(date) — OSM download complete"

# Remove old graph so OTP rebuilds on next start
rm -f ./data/graph.obj
echo "$(date) — Removed old graph, OTP will rebuild on next start"

# places.db (POI search — see src/lib/places-db.ts) is not an OTP input at
# all, so it doesn't belong under ./data with the graph's own sources; it
# goes wherever src/lib/db.ts's own defaultDataDir() would put traffic.db,
# mirrored here so a fresh clone's dev server finds it with no extra setup.
# Skips the download entirely if osmium is available locally — a dev who can
# build the real thing from otp/data/estonia-latest.osm.pbf (see
# scripts/build-places-db.ts) shouldn't have a stale weekly release
# silently overwrite their own local build.
if command -v osmium >/dev/null 2>&1; then
  echo "$(date) — osmium found locally; skipping places.db download (run scripts/build-places-db.ts yourself)"
else
  if [ -n "${TRAFFIC_DATA_DIR:-}" ]; then
    PLACES_DIR="$TRAFFIC_DATA_DIR"
  elif [ -n "${LOCALAPPDATA:-}" ]; then
    PLACES_DIR="$LOCALAPPDATA/livetravel/traffic-data"
  else
    PLACES_DIR="$parent_path/../traffic-data"
  fi
  mkdir -p "$PLACES_DIR"
  echo "$(date) — Downloading places.db (POI search) to $PLACES_DIR..."
  curl -L -o "$PLACES_DIR/places.db" "https://github.com/noobah1/didactic-pancake/releases/download/places-db/places.db"
  echo "$(date) — places.db download complete"
fi
