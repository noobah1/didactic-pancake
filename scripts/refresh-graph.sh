#!/bin/sh
# Pulls the latest OTP graph (built nightly by CI, see .github/workflows/build-otp-graph.yml)
# and restarts OTP so it loads it. Run on the server via cron, e.g.:
#   0 4 * * * /path/to/repo/scripts/refresh-graph.sh >> /var/log/refresh-graph.log 2>&1
set -e
cd "$(dirname "$0")/.."

before=$(git rev-parse HEAD:otp/graph.obj 2>/dev/null || echo none)
git pull --ff-only
after=$(git rev-parse HEAD:otp/graph.obj 2>/dev/null || echo none)

if [ "$before" != "$after" ]; then
  echo "$(date) - graph.obj changed, restarting otp"
  docker compose restart otp
else
  echo "$(date) - graph.obj unchanged, nothing to do"
fi
