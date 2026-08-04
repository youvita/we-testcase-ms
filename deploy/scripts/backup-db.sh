#!/usr/bin/env bash
# Dump Postgres into deploy/backups/ with a timestamped filename.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.production ]]; then
  echo "Missing .env.production" >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a
# shellcheck source=/dev/null
source .env.production
set +a

DB="${POSTGRES_DB:-wetestcase}"
USER="${POSTGRES_USER:-postgres}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${ROOT}/deploy/backups"
OUT="${OUT_DIR}/wetestcase-${STAMP}.sql.gz"

mkdir -p "$OUT_DIR"

echo "==> Backing up ${DB} → ${OUT}"
docker exec wetestcase-postgres \
  pg_dump -U "$USER" -d "$DB" --clean --if-exists \
  | gzip > "$OUT"

# Keep last 14 dumps by default
KEEP="${BACKUP_KEEP:-14}"
ls -1t "$OUT_DIR"/wetestcase-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r f; do
  rm -f "$f"
done

echo "    done ($(du -h "$OUT" | awk '{print $1}'))"
