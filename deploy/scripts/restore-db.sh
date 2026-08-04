#!/usr/bin/env bash
# Restore a gzipped pg_dump into the production database.
# Usage: ./deploy/scripts/restore-db.sh deploy/backups/wetestcase-YYYYMMDD-HHMMSS.sql.gz
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "Usage: $0 path/to/backup.sql.gz" >&2
  exit 1
fi

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

echo "WARNING: This will overwrite database '${DB}' from ${FILE}"
read -r -p "Type 'restore' to continue: " confirm
if [[ "$confirm" != "restore" ]]; then
  echo "Aborted."
  exit 1
fi

echo "==> Restoring..."
gunzip -c "$FILE" | docker exec -i wetestcase-postgres \
  psql -U "$USER" -d "$DB" -v ON_ERROR_STOP=1

echo "==> Restarting app so connections refresh"
docker compose -f docker-compose.prod.yml --env-file .env.production restart app
echo "    done"
