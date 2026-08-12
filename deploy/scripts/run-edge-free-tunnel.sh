#!/usr/bin/env bash
# ONE free Cloudflare Quick Tunnel → nginx edge → many local apps.
#
# Prerequisites:
#   1. Apps listening: we-testcase :3000, SecureScan :3001
#   2. Edge proxy:     npm run edge:up
#
# Usage:
#   npm run tunnel:edge
#
# Leave this process running across app redeploys so the trycloudflare URL stays.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ORIGIN="${1:-http://127.0.0.1:8080}"
PROTOCOL="${CLOUDFLARED_PROTOCOL:-http2}"

if ! command -v cloudflared >/dev/null 2>&1; then
  cat <<'EOF' >&2
cloudflared is not installed.

  macOS:  brew install cloudflare/cloudflare/cloudflared
  or:     brew install cloudflared

EOF
  exit 1
fi

if ! curl -fsS -o /dev/null -m 5 "${ORIGIN}/healthz"; then
  cat <<EOF >&2
Edge proxy is not reachable at ${ORIGIN}/healthz

Start it first:
  cd ${ROOT}
  npm run edge:up

Then re-run:
  npm run tunnel:edge
EOF
  exit 1
fi

cat <<EOF
================================================================
  ONE free tunnel → nginx edge → many apps
================================================================
  edge origin:  ${ORIGIN}
  protocol:     ${PROTOCOL}

  After the URL prints, open:
    https://….trycloudflare.com/              (status page)
    https://….trycloudflare.com/cases/       → :3000 we-testcase
    https://….trycloudflare.com/securescan/  → :3001 SecureScan

  Apps must be built with BASE_PATH=/cases and /securescan.
  Do NOT also run npm run tunnel:free (that is a second tunnel).

  Leave this running across deploys to keep the same URL.
  Ctrl+C stops only the tunnel (edge + apps keep running).
================================================================

EOF

exec cloudflared tunnel --url "$ORIGIN" --protocol "$PROTOCOL" --no-autoupdate
