#!/usr/bin/env bash
# Free public HTTPS URL — no domain purchase required.
#
# Uses Cloudflare Quick Tunnels (*.trycloudflare.com). Completely free.
# Limitations:
#   - URL is random and changes every time you restart this script
#   - Meant for personal / demo use, not a fixed team link forever
#
# Usage:
#   1. Start the app stack:  ./deploy/scripts/deploy.sh
#   2. Run this tunnel:      ./deploy/scripts/run-free-tunnel.sh
#   3. Open the https://….trycloudflare.com URL printed in the terminal
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

if ! curl -fsS "${ORIGIN}/api/health" >/dev/null 2>&1; then
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
  FREE tunnel (no domain) — Cloudflare trycloudflare.com
================================================================
  origin (your app):  ${ORIGIN}
  protocol:           ${PROTOCOL}

  This trycloudflare URL CHANGES every time you re-run this script.
  After redeploy, the stable sample URL is always:

    ${SAMPLE_APP_URL:-http://127.0.0.1:3000}
    ${SAMPLE_HEALTH_URL:-http://127.0.0.1:3000/api/health}

  Wait for a line like:
    https://random-words.trycloudflare.com

  Press Ctrl+C to stop the tunnel (the app keeps running on port 3000).
================================================================

EOF

# --protocol http2 avoids QUIC/UDP blocks that cause:
#   ERR Failed to dial a quic connection ... timeout: no recent network activity
exec cloudflared tunnel --url "$ORIGIN" --protocol "$PROTOCOL" --no-autoupdate
