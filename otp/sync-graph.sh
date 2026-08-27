#!/bin/bash
# Pulls otp/graph.obj from the "otp-graph" GitHub Release (published weekly
# by .github/workflows/build-otp-graph.yml, or manually via workflow_dispatch)
# and reloads it into the running otp container — only when the published
# graph is actually newer than what's currently loaded here.
#
# Meant to run on a schedule on the deploy server itself (see the systemd
# timer set up alongside this — otp-graph-sync.timer), not in CI: the build
# workflow only builds+publishes, it has no access to the server, so nothing
# used to pull the result back down. Checking daily rather than trying to
# time this to the weekly build's exact schedule means it also picks up an
# off-schedule manual rebuild (workflow_dispatch) within a day, with no
# separate logic needed for that case.
set -euo pipefail

REPO="noobah1/didactic-pancake"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRAPH_PATH="$APP_DIR/otp/graph.obj"
STATE_FILE="$APP_DIR/otp/.graph-synced-at"
MIN_EXPECTED_BYTES=50000000 # current graph is ~200MB; anything drastically smaller is a bad download, not a real graph

log() { echo "$(date -u +%FT%TZ) sync-graph: $*"; }

release_json=$(curl -sf "https://api.github.com/repos/$REPO/releases/tags/otp-graph") || {
  log "failed to query GitHub release metadata"
  exit 1
}

updated_at=$(echo "$release_json" | jq -r '.assets[] | select(.name=="graph.obj") | .updated_at')
download_url=$(echo "$release_json" | jq -r '.assets[] | select(.name=="graph.obj") | .browser_download_url')

if [ -z "$updated_at" ] || [ "$updated_at" = "null" ]; then
  log "no graph.obj asset found on the otp-graph release"
  exit 1
fi

current=$(cat "$STATE_FILE" 2>/dev/null || echo "")
if [ "$updated_at" = "$current" ]; then
  log "already up to date ($updated_at)"
  exit 0
fi

log "new graph available: $updated_at (have: ${current:-none}) — downloading"
tmp="$GRAPH_PATH.new"
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

backup="$GRAPH_PATH.bak"
cp "$GRAPH_PATH" "$backup"
mv "$tmp" "$GRAPH_PATH"

log "restarting otp container"
cd "$APP_DIR"
docker compose restart otp

# Give the healthcheck (interval 10s, up to 60 retries per compose.yaml) up
# to 3 minutes to confirm the new graph actually loads before trusting it.
healthy=false
for _ in $(seq 1 36); do
  status=$(docker compose ps otp --format '{{.Status}}' 2>/dev/null || echo "")
  if echo "$status" | grep -q healthy; then
    healthy=true
    break
  fi
  sleep 5
done

if [ "$healthy" = true ]; then
  log "otp healthy on new graph — sync complete"
  echo "$updated_at" > "$STATE_FILE"
  rm -f "$backup"

  # The app keeps its own in-memory copy of every stop/line name
  # (transitStopsCache in src/app/api/geocode/route.ts), refreshed on its own
  # schedule (up to 6h, further if a refresh attempt happens to land while
  # otp is mid-restart) rather than in step with otp's own graph. Restarting
  # otp alone left a new or renamed line unsearchable — present in the fresh
  # graph, invisible in the departures-tab search — until that cache next
  # happened to refresh. Restarting the app here forces it to pick up the
  # new graph immediately instead of on its own delayed schedule.
  log "restarting app to refresh its in-memory route/stop cache"
  docker compose restart didacticpancake
else
  log "otp did not become healthy on the new graph after 3 minutes — rolling back"
  mv "$backup" "$GRAPH_PATH"
  docker compose restart otp
  log "rolled back to previous graph"
  exit 1
fi
