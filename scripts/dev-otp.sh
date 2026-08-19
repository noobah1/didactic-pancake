#!/bin/sh
# Spins up an OTP instance completely isolated from production's apps-otp-1
# (see compose.yaml) — its own Compose project name and host port, so
# `docker compose stop`/`down` run against it can never touch the container
# real users are hitting. Exists because that's exactly what happened once:
# testing against the shared prod OTP container left it stopped for real
# users until someone noticed the app was broken.
#
# Usage:
#   scripts/dev-otp.sh up      # start (or reuse) the isolated instance, wait until healthy
#   scripts/dev-otp.sh down    # stop and remove it
#   scripts/dev-otp.sh status  # show whether it's running
set -e
cd "$(dirname "$0")/.."

PROJECT=otp-test
PORT=8090
COMPOSE="docker compose -p $PROJECT -f compose.yaml -f scripts/dev-otp.override.yaml"

case "$1" in
  up)
    $COMPOSE up -d otp
    echo "Waiting for OTP to load the graph..."
    until curl -sf "http://localhost:$PORT/otp/actuators/health" > /dev/null 2>&1; do
      sleep 3
    done
    echo "Ready. Point the app at it with:"
    echo "  OTP_BASE_URL=http://localhost:$PORT npm run dev"
    ;;
  down)
    $COMPOSE down
    ;;
  status)
    $COMPOSE ps
    ;;
  *)
    echo "Usage: $0 {up|down|status}" >&2
    exit 1
    ;;
esac
