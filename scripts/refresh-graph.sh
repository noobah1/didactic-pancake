#!/bin/sh
# Downloads the latest OTP graph (built weekly by CI, see
# .github/workflows/build-otp-graph.yml, published to the "otp-graph" release)
# and restarts OTP so it loads it. Run on the server via cron, e.g.:
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
else
  echo "$(date) - graph unchanged, nothing to do"
  rm -f "$NEW"
fi
