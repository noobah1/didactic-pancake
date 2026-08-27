#!/bin/sh
# Downloads the latest OTP graph (built weekly by CI, see
# .github/workflows/build-otp-graph.yml, published to the "otp-graph" release)
# and restarts OTP so it loads it, then restarts the app so its own in-memory
# stop/line cache picks up the new graph too. Run on the server via cron, e.g.:
#   0 4 * * 0 /path/to/repo/scripts/refresh-graph.sh >> /var/log/refresh-graph.log 2>&1
#
# Only works as-is for a public repo. If this repo is private, set GH_TOKEN
# (a PAT with read access) in the environment before running.
set -e
cd "$(dirname "$0")/.."

REPO="noobah1/didactic-pancake"
NEW=otp/graph.obj.new

if [ -n "$GH_TOKEN" ]; then
  ASSET_URL=$(curl -sH "Authorization: Bearer $GH_TOKEN" \
    "https://api.github.com/repos/$REPO/releases/tags/otp-graph" \
    | grep -o '"url": *"[^"]*assets/[0-9]*"' | head -1 | grep -o 'https://[^"]*')
  curl -L -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/octet-stream" \
    -o "$NEW" "$ASSET_URL"
else
  curl -L -o "$NEW" "https://github.com/$REPO/releases/download/otp-graph/graph.obj"
fi

if ! cmp -s "$NEW" otp/graph.obj; then
  echo "$(date) - new graph downloaded, restarting otp"
  mv "$NEW" otp/graph.obj
  docker compose restart otp
  # The app holds its own in-memory copy of every stop/line name
  # (transitStopsCache in src/app/api/geocode/route.ts) refreshed on its own
  # multi-hour schedule, not in step with otp's graph — restarting otp alone
  # left a new/renamed line invisible in the departures-tab search (present
  # in the fresh graph, but absent from the app's stale cached list) until
  # that cache next happened to refresh on its own. Restart the app too so
  # it picks up the new graph right away.
  docker compose restart didacticpancake
else
  echo "$(date) - graph unchanged, nothing to do"
  rm -f "$NEW"
fi
