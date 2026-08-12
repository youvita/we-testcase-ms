# Production image for monorepo (apps/web + packages/dto).
# npm workspaces hoist deps to the repo-root node_modules — do not expect
# apps/web/node_modules or packages/dto/node_modules to exist.
#
#   docker build -t wetestcase-ms .
#   docker compose -f docker-compose.prod.yml up -d --build

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
# Package manifests only (cache layer)
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/dto/package.json ./packages/dto/
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/package-lock.json ./
COPY --from=deps /app/apps/web/package.json ./apps/web/
COPY --from=deps /app/packages/dto/package.json ./packages/dto/

# Full source (dto types/schemas + Next app + prisma)
COPY packages/dto ./packages/dto
COPY apps/web ./apps/web
COPY package.json package-lock.json ./

# Leave empty for free trycloudflare tunnels so the browser uses the current
# host (window.location.origin). Only set when you have a fixed public HTTPS URL.
ARG NEXT_PUBLIC_APP_URL=
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# Shared edge URL path prefix (one Cloudflare host → /cases + /securescan).
ARG BASE_PATH=/cases
ENV BASE_PATH=$BASE_PATH
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

WORKDIR /app/apps/web
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV UPLOAD_DIR=/app/uploads
ARG BASE_PATH=/cases
ENV BASE_PATH=$BASE_PATH

RUN apk add --no-cache libc6-compat openssl dumb-init \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Prisma for migrate on boot
COPY --from=builder /app/apps/web/prisma ./prisma
COPY --from=builder /app/apps/web/package.json ./package.json
# Prisma CLI lives in the hoisted monorepo node_modules
COPY --from=builder /app/node_modules ./node_modules

# Next.js standalone server (outputFileTracingRoot = monorepo root)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

COPY --chown=nextjs:nodejs deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh \
  && mkdir -p /app/uploads \
  && chown -R nextjs:nodejs /app/uploads

# Prefer monorepo standalone path; fallback if Next lays out differently
USER nextjs
EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["/app/entrypoint.sh"]
