#!/bin/sh
# Redeploys the app from the current state of origin/main. Run on the server
# itself (e.g. by the GitHub Actions workflow in
# .github/workflows/deploy.yml over a restricted-command SSH key) after every
# push to main.
#
# graph.obj is gitignored and untouched by git operations, so a hard reset
# never wipes it — it's refreshed separately, weekly, by
# scripts/refresh-graph.sh.
set -e
cd "$(dirname "$0")/.."

git fetch origin main
git reset --hard origin/main
docker compose build
docker compose up -d
docker image prune -f
