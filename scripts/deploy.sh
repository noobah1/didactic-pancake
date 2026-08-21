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

# A deploy that gets killed mid-recreate (e.g. an SSH timeout) can leave
# behind an orphaned "<hash>_<service>-<n>" container: docker compose
# renames the old container to that form to free up its name for the new
# one, then never gets to remove it. Left in place, it blocks every future
# recreate with a "name already in use" conflict, so clear any such
# leftovers before deploying.
docker ps -a --format '{{.Names}}' | grep -E '^[0-9a-f]+_app-[a-zA-Z0-9-]+-[0-9]+$' | xargs -r docker rm -f

docker compose build
docker compose up -d
docker image prune -f
