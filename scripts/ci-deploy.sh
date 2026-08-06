#!/usr/bin/env bash
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
