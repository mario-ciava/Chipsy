#!/usr/bin/env bash

set -euo pipefail

BRANCH="${1:-${CHIPSY_DEPLOY_BRANCH:-main}}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA_COMPOSE="${INFRA_COMPOSE:-../infrastructure/docker-compose.infra.yml}"
APP_COMPOSE="${APP_COMPOSE:-docker-compose.yml}"

cd "$REPO_DIR"

echo ">>> Deploying branch '$BRANCH' inside $REPO_DIR"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "This script must be executed from inside the Chipsy repository." >&2
    exit 1
fi

git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"

if [ ! -f "$INFRA_COMPOSE" ]; then
    echo "Infrastructure compose file not found at '$INFRA_COMPOSE'." >&2
    echo "Make sure the shared infra repo is cloned next to Chipsy or override INFRA_COMPOSE." >&2
    exit 1
fi

echo ">>> Ensuring infrastructure stack is online"
docker compose -f "$INFRA_COMPOSE" up -d

echo ">>> Building and restarting application stack"
docker compose -f "$APP_COMPOSE" up -d --build --remove-orphans

echo ">>> Cleaning dangling images"
docker image prune -f >/dev/null

echo "✅ Deploy completed"
