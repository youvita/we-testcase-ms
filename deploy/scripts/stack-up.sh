#!/usr/bin/env bash
# Rebuild and restart the app only. Never starts or stops Cloudflare.
#
# Pair with a long-lived free tunnel in another terminal:
#   Terminal 1 (leave open):  npm run tunnel:free
#   Terminal 2 (redeploy):    npm run docker:stack:up
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source "${ROOT}/deploy/sample-urls.env"

if [[ ! -f .env.production ]]; then
  echo "Missing .env.production — run ./deploy/scripts/setup-mac-mini.sh first." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running." >&2
  exit 1
fi

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)

echo "==> Redeploying app only (tunnel is not touched)"
# Named services only — no --profile tunnel, no --remove-orphans.
# Postgres starts if it is down; it is not recreated if already running.
"${COMPOSE[@]}" up -d --build app

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
"${COMPOSE[@]}" ps app postgres
echo
cat <<EOF
================================================================
  App redeployed — Cloudflare tunnel was NOT restarted
================================================================
  Local:   ${SAMPLE_APP_URL}
  Health:  ${SAMPLE_HEALTH_URL}

  If Terminal 1 is still running \`npm run tunnel:free\`,
  the same https://….trycloudflare.com URL still works.
================================================================
EOF
