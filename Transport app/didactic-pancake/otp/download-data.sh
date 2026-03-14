#!/bin/bash
set -e

DATA_DIR="/var/opentripplanner/data"
GTFS_URL="https://eu-gtfs.remix.com/estonia_unified_gtfs.zip"
OSM_URL="https://download.geofabrik.de/europe/estonia-latest.osm.pbf"

echo "$(date) — Downloading GTFS data..."
curl -L -o "$DATA_DIR/estonia_unified_gtfs.zip.tmp" "$GTFS_URL"
mv "$DATA_DIR/estonia_unified_gtfs.zip.tmp" "$DATA_DIR/estonia_unified_gtfs.zip"
echo "$(date) — GTFS download complete"

echo "$(date) — Downloading OSM data..."
curl -L -o "$DATA_DIR/estonia-latest.osm.pbf.tmp" "$OSM_URL"
mv "$DATA_DIR/estonia-latest.osm.pbf.tmp" "$DATA_DIR/estonia-latest.osm.pbf"
echo "$(date) — OSM download complete"

# Remove old graph so OTP rebuilds on next start
rm -f /var/opentripplanner/graph.obj
echo "$(date) — Removed old graph, OTP will rebuild on next start"
