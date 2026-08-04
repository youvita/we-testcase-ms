#!/usr/bin/env bash
# Pull latest code (optional), rebuild, and restart the production stack.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# Stable URLs with ports — same after every redeploy (not trycloudflare).
# shellcheck source=../sample-urls.env
# shellcheck disable=SC1091
source "${ROOT}/deploy/sample-urls.env"

usage() {
  cat <<'EOF'
Usage: ./deploy/scripts/deploy.sh [options]

Options:
  --pull          git pull --ff-only before building
  --tunnel        also start the cloudflared profile
  --no-build      only recreate containers (reuse existing image)
  -h, --help      show this help

After a successful deploy the sample URLs never change:
  App:      http://127.0.0.1:3000
  Health:   http://127.0.0.1:3000/api/health
  Postgres: 127.0.0.1:5434  (DBeaver)
EOF
}

DO_PULL=0
DO_BUILD=1
WITH_TUNNEL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull) DO_PULL=1; shift ;;
    --tunnel) WITH_TUNNEL=1; shift ;;
    --no-build) DO_BUILD=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ ! -f .env.production ]]; then
  echo "Missing .env.production — run ./deploy/scripts/setup-mac-mini.sh first." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running." >&2
  exit 1
fi

if [[ "$DO_PULL" -eq 1 ]]; then
  echo "==> git pull --ff-only"
  git pull --ff-only
fi

echo "==> Ensuring backups directory exists"
mkdir -p deploy/backups

compose() {
  if [[ "$WITH_TUNNEL" -eq 1 ]]; then
    docker compose -f docker-compose.prod.yml --env-file .env.production --profile tunnel "$@"
  else
    docker compose -f docker-compose.prod.yml --env-file .env.production "$@"
  fi
}

if [[ "$DO_BUILD" -eq 1 ]]; then
  echo "==> Building and starting stack"
  compose up -d --build --remove-orphans
else
  echo "==> Starting stack (no rebuild)"
  compose up -d --remove-orphans
fi

echo "==> Waiting for app health at ${SAMPLE_HEALTH_URL} ..."
for i in $(seq 1 40); do
  if curl -fsS "${SAMPLE_HEALTH_URL}" >/dev/null 2>&1; then
    echo "    healthy"
    break
  fi
  if [[ "$i" -eq 40 ]]; then
    echo "App did not become healthy in time. Check: docker compose -f docker-compose.prod.yml logs app" >&2
    exit 1
  fi
  sleep 2
done

echo
compose ps
echo

PUBLIC_NOTE="(not set — free trycloudflare URLs change every tunnel restart)"
if [[ -f "${ROOT}/deploy/public-url.env" ]]; then
  # shellcheck disable=SC1091
  source "${ROOT}/deploy/public-url.env"
  PUBLIC_NOTE="${PUBLIC_APP_URL}"
fi

cat <<EOF
================================================================
  After redeploy — URLs
================================================================
  Local app (always):     ${SAMPLE_APP_URL}
  Health:                 ${SAMPLE_HEALTH_URL}
  Postgres (DBeaver):     ${SAMPLE_DB_HOST}:${SAMPLE_DB_PORT}

  Stable public Cloudflare (named tunnel):
    ${PUBLIC_NOTE}

  Free random tunnel (changes every start — not for production):
    ./deploy/scripts/run-free-tunnel.sh

  Permanent Cloudflare URL (once, needs a domain on Cloudflare):
    ./deploy/scripts/setup-stable-cloudflare-tunnel.sh app.yourdomain.com
================================================================
EOF
