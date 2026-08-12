#!/usr/bin/env bash
# One-time prep on the Mac mini host.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "==> TestCase MS — Mac mini setup"
echo "    project root: $ROOT"
echo

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need docker
need openssl

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but not running. Start Docker Desktop (or Colima) and re-run." >&2
  exit 1
fi

if [[ ! -f .env.production ]]; then
  echo "==> Creating .env.production from template"
  cp .env.production.example .env.production
  SECRET="$(openssl rand -base64 32)"
  # portable in-place replace for macOS / Linux
  if sed --version >/dev/null 2>&1; then
    sed -i "s|replace-me-with-a-32-byte-random-string|${SECRET}|g" .env.production
  else
    sed -i '' "s|replace-me-with-a-32-byte-random-string|${SECRET}|g" .env.production
  fi
  echo "    wrote BETTER_AUTH_SECRET"
  echo
  echo "    Edit .env.production before starting:"
  echo "      - POSTGRES_PASSWORD"
  echo "      - DATABASE_URL / DIRECT_URL (same password)"
  echo "      - BETTER_AUTH_URL / NEXT_PUBLIC_APP_URL (your Cloudflare hostname)"
  echo
else
  echo "==> .env.production already exists — leaving it alone"
fi

mkdir -p deploy/backups deploy/cloudflared uploads
touch deploy/backups/.gitkeep

if [[ ! -f deploy/cloudflared/config.yml && -f deploy/cloudflared/config.example.yml ]]; then
  cp deploy/cloudflared/config.example.yml deploy/cloudflared/config.yml
  echo "==> Created deploy/cloudflared/config.yml from example — edit tunnel UUID + hostname"
fi

echo
echo "==> Next steps (FREE — no domain)"
echo "    1. Edit .env.production:"
echo "         - POSTGRES_PASSWORD (+ same password in DATABASE_URL / DIRECT_URL)"
echo "         - leave BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL empty"
echo "    2. brew install cloudflared   # once"
echo "    3. npm run docker:stack:up"
echo "    4. Terminal 1 (leave running): npm run tunnel:free"
echo "       → open the https://….trycloudflare.com URL it prints"
echo "    5. Later redeploys (tunnel stays up): npm run docker:stack:up"
echo
echo "    Later, for a fixed URL: buy/add any domain to Cloudflare"
echo "    (see deploy/README.md — named tunnel section)."
echo
echo "Done."
