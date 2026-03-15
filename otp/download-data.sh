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
