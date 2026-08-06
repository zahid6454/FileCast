#!/usr/bin/env bash
# Deploys whatever tag currently sorts newest by creation date — not
# necessarily the tag that triggered this run. Never push a tag without
# publishing a GitHub Release for it: an orphaned tag sits dormant (nothing
# triggers on a bare tag push) until the next real release, at which point
# it could out-sort the intended tag and deploy instead.
set -euo pipefail
cd ~/FileCast
git fetch --tags origin --force
LATEST_TAG=$(git tag --sort=-creatordate | head -1)
if [ -z "$LATEST_TAG" ]; then
  echo "No tags found — nothing to deploy." >&2
  exit 1
fi
git checkout "$LATEST_TAG"
cd api
GIT_SHA=$(git -C ~/FileCast rev-parse HEAD) docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
