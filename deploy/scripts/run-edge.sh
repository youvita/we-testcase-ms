#!/usr/bin/env bash
# Start (or restart) the Mac mini nginx edge on 127.0.0.1:8080
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="${ROOT}/deploy/edge/docker-compose.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the edge proxy." >&2
  exit 1
fi

echo "==> Starting macmini-edge (nginx on 127.0.0.1:8080)"
docker compose -f "$COMPOSE" up -d

echo "==> Waiting for /healthz"
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null -m 2 "http://127.0.0.1:8080/healthz"; then
    echo "Edge is up: http://127.0.0.1:8080/"
    echo "  we-testcase path:  http://127.0.0.1:8080/cases/"
    echo "  SecureScan path:   http://127.0.0.1:8080/securescan/"
    echo "Next: npm run tunnel:edge   (Docker Quick Tunnel → this proxy)"
    exit 0
  fi
  sleep 0.5
done

echo "Edge did not become healthy. Check: docker logs macmini-edge" >&2
exit 1
