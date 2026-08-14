#!/usr/bin/env bash
# ONE free Cloudflare Quick Tunnel in Docker → nginx edge → many local apps.
#
# Prerequisites:
#   1. Apps listening: we-testcase :3000, SecureScan :3001
#   2. Edge proxy:     npm run edge:up  (started automatically if missing)
#
# Usage:
#   npm run tunnel:edge
#   npm run tunnel:edge:url
#
# The tunnel container keeps running after this script exits.
# Restarting it mints a new trycloudflare URL — leave macmini-tunnel up.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="${ROOT}/deploy/edge/docker-compose.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the edge tunnel." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and re-run." >&2
  exit 1
fi

echo "==> Starting macmini-edge + macmini-tunnel (Docker)"
docker compose -f "$COMPOSE" --profile tunnel up -d

echo "==> Waiting for trycloudflare URL"
URL=""
for _ in $(seq 1 40); do
  URL="$(docker logs macmini-tunnel 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
  if [[ -n "$URL" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$URL" ]]; then
  echo "Tunnel started but the public URL has not appeared yet." >&2
  echo "Check: docker logs -f macmini-tunnel" >&2
  exit 1
fi

cat <<EOF

================================================================
  ONE Docker tunnel → nginx edge → both apps
================================================================
  ${URL}/
  ${URL}/cases/        → we-testcase :3000
  ${URL}/securescan/   → SecureScan  :3001

  Container: macmini-tunnel (restart unless-stopped)
  Do NOT also run npm run tunnel:free.

  Print URL later:  npm run tunnel:edge:url
  Stop tunnel:      npm run tunnel:edge:down
================================================================
EOF
