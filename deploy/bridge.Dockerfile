# The local Claude bridge, as a service in the stack.
#
# Claude Code and one script: scripts/claude-bridge.mjs answers the Anthropic Messages API
# by running `claude --print` as the subscription token each request carries, and the app
# talks to it instead of api.anthropic.com. It has no login of its own. The script is the
# same one WePlanner (we-adp) runs — keep the two in step rather than letting them drift.
#
# Debian rather than Alpine, unlike the web image. Claude Code ships native helpers built
# against glibc, and on musl they fail in ways that surface at the first request rather
# than at install time.
FROM node:22-slim AS runtime

# Bumped by rebuilding: `docker compose build claude-bridge`. Pin it here when a release
# misbehaves — the bridge only uses `--print`, which is the CLI's most stable surface.
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
    && npm cache clean --force

# Not root. Claude Code warns on a root session, and nothing here needs the privilege.
# `node` ships with the image; it gets a home because the CLI writes config and cache there.
ENV HOME=/home/node
RUN mkdir -p /home/node /app && chown -R node:node /home/node /app
WORKDIR /app
COPY --chown=node:node scripts/claude-bridge.mjs ./claude-bridge.mjs
USER node

# The compose network, not loopback. The bridge authenticates nobody, so it binds the
# container's own interface and only the stack (or 127.0.0.1 on the host, in dev) reaches it.
ENV CLAUDE_BRIDGE_HOST=0.0.0.0
ENV CLAUDE_BRIDGE_PORT=8788
EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:8788/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "/app/claude-bridge.mjs"]
