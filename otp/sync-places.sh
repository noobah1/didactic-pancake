#!/bin/bash
# Pulls otp/data/places.db from the "places-db" GitHub Release (published
# weekly by .github/workflows/build-places-db.yml, or manually via
# workflow_dispatch) whenever a newer one is published, and swaps it into
# place with an atomic `mv`.
#
# Deliberately simpler than sync-graph.sh (which restarts the otp container
# and rolls back on a failed healthcheck): src/lib/places-db.ts never writes
# to this file, only reads it, and re-stats it before every search — so an
# atomic `mv` alone is enough. The app's already-open read handle (if any)
# keeps reading the old, now-unlinked inode until that mtime check notices
# and reopens; there is no container to restart and no "did it come up
# healthy" to wait on. See places-db.ts's own comment for why this is safe
# without a restart, and Markdown.md/README.md for where this fits.
#
# Meant to run on a schedule on the deploy server itself (see the systemd
# timer alongside this — places-sync.timer), same reasoning as
# sync-graph.sh's own timer: the build workflow only builds+publishes, it
# has no access to the server.
set -euo pipefail

REPO="noobah1/didactic-pancake"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# NOT otp/data — places.db is never read by the otp container (OTP only
# ever sees the .osm.pbf this was built from, and throws away every tag
# this database keeps). It's read by the app container, from the same
# TRAFFIC_DATA_DIR bind mount as traffic.db (see compose.yaml and
# src/lib/places-db.ts's defaultDataDir, which mirrors src/lib/db.ts's).
PLACES_PATH="$APP_DIR/traffic-data/places.db"
STATE_FILE="$APP_DIR/otp/.places-synced-at"
# Verified against a real build: ~60-90k named, categorized places nationwide
# lands around 10-20MB. Anything drastically smaller is a bad download or a
# broken build, not a real database.
MIN_EXPECTED_BYTES=2000000

log() { echo "$(date -u +%FT%TZ) sync-places: $*"; }

release_json=$(curl -sf "https://api.github.com/repos/$REPO/releases/tags/places-db") || {
  log "failed to query GitHub release metadata"
  exit 1
}

updated_at=$(echo "$release_json" | jq -r '.assets[] | select(.name=="places.db") | .updated_at')
download_url=$(echo "$release_json" | jq -r '.assets[] | select(.name=="places.db") | .browser_download_url')

if [ -z "$updated_at" ] || [ "$updated_at" = "null" ]; then
  log "no places.db asset found on the places-db release"
  exit 1
fi

current=$(cat "$STATE_FILE" 2>/dev/null || echo "")
if [ "$updated_at" = "$current" ]; then
  log "already up to date ($updated_at)"
  exit 0
fi

log "new places.db available: $updated_at (have: ${current:-none}) — downloading"
tmp="$PLACES_PATH.new"
if ! curl -sfL -o "$tmp" "$download_url"; then
  log "download failed"
  rm -f "$tmp"
  exit 1
fi

size=$(stat -c%s "$tmp")
if [ "$size" -lt "$MIN_EXPECTED_BYTES" ]; then
  log "downloaded file suspiciously small ($size bytes) — aborting"
  rm -f "$tmp"
  exit 1
fi

mkdir -p "$(dirname "$PLACES_PATH")"
mv "$tmp" "$PLACES_PATH"
echo "$updated_at" > "$STATE_FILE"
log "swapped in new places.db — app will pick it up on its next search (mtime-based reopen, see places-db.ts)"
