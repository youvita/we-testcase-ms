#!/bin/sh
set -eu

echo "[entrypoint] Applying Prisma migrations..."
if [ -f /app/prisma/schema.prisma ]; then
  npx prisma migrate deploy --schema=/app/prisma/schema.prisma
elif [ -f /app/apps/web/prisma/schema.prisma ]; then
  npx prisma migrate deploy --schema=/app/apps/web/prisma/schema.prisma
else
  npx prisma migrate deploy
fi

echo "[entrypoint] Starting Next.js on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"

if [ -f /app/apps/web/server.js ]; then
  exec node /app/apps/web/server.js
fi
if [ -f /app/server.js ]; then
  exec node /app/server.js
fi

echo "[entrypoint] No standalone server.js found" >&2
ls -la /app >&2 || true
ls -la /app/apps/web 2>/dev/null >&2 || true
exit 1
