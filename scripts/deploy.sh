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

# .github/workflows/deploy.yml queues its own runs (see the concurrency group
# there), but that only serializes deploys GitHub itself starts — it does
# nothing about a hand-run deploy landing on top of one. Two builds at once on
# this single-core box starve the otp container badly enough to take down
# journey planning, live delays and stop search until they finish, so hold a
# real lock here too. Waits rather than bails: a queued deploy still has to
# apply, and the workflow's own command_timeout (20m) is the outer bound.
exec 9>/tmp/deploy-app.lock
if ! flock -w 1200 9; then
  echo "another deploy is still running after 20 minutes — aborting" >&2
  exit 1
fi

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
