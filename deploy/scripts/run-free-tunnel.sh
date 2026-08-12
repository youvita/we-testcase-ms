#!/usr/bin/env bash
# Free public HTTPS URL — no domain purchase required.
#
# Uses Cloudflare Quick Tunnels (*.trycloudflare.com). Completely free.
# Limitations:
#   - URL is random and changes every time you restart this script
#   - Meant for personal / demo use, not a fixed team link forever
#
# Usage:
#   Terminal 1 (start once, leave running):
#     npm run tunnel:free
#   Terminal 2 (redeploy app only — same public URL):
#     npm run docker:stack:up
#
# If you see "Failed to dial a quic connection" / timeout, that is usually a
# network blocking UDP. This script defaults to HTTP/2 over TCP.
# Override: CLOUDFLARED_PROTOCOL=quic ./deploy/scripts/run-free-tunnel.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT}/deploy/sample-urls.env"

ORIGIN="${1:-${SAMPLE_APP_URL}}"
# http2 = TCP (works behind most office/home firewalls)
# quic   = UDP (faster when allowed)
PROTOCOL="${CLOUDFLARED_PROTOCOL:-http2}"

if ! command -v cloudflared >/dev/null 2>&1; then
  cat <<'EOF' >&2
cloudflared is not installed.

  macOS:  brew install cloudflare/cloudflare/cloudflared
  or:     brew install cloudflared

EOF
  exit 1
fi

if ! curl -fsS "${SAMPLE_HEALTH_URL:-${ORIGIN}/cases/api/health}" >/dev/null 2>&1; then
  cat <<EOF >&2
App is not reachable at ${ORIGIN}

Start it first:
  ./deploy/scripts/setup-mac-mini.sh   # once
  # edit .env.production (set POSTGRES_PASSWORD; leave public URLs empty for free mode)
  ./deploy/scripts/deploy.sh

Then re-run:
  ./deploy/scripts/run-free-tunnel.sh
EOF
  exit 1
fi

cat <<EOF
================================================================
  FREE tunnel — leave this terminal running
================================================================
  origin:    ${ORIGIN}
  protocol:  ${PROTOCOL}

  Copy the https://….trycloudflare.com URL below and keep this
  process alive. Redeploy the app in another terminal with:

    npm run docker:stack:up

  That does NOT restart this tunnel → same public URL.

  Ctrl+C here = tunnel dies and the next start gets a NEW URL.
================================================================

EOF

# --protocol http2 avoids QUIC/UDP blocks that cause:
#   ERR Failed to dial a quic connection ... timeout: no recent network activity
exec cloudflared tunnel --url "$ORIGIN" --protocol "$PROTOCOL" --no-autoupdate
