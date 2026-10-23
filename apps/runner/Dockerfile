# The automation runner: Playwright with its browsers, plus apps/runner.
#
# Built from the repository root (it needs the workspace lockfile):
#   docker build -f apps/runner/Dockerfile .
#
# The base image tag must match the @playwright/test version in
# apps/runner/package.json exactly — the browsers are baked into the image and
# a different library version will refuse to launch them.
FROM mcr.microsoft.com/playwright:v1.64.0-noble

WORKDIR /repo

# Manifests first, so dependency installs are cached across code changes. Every
# workspace's package.json is needed for `npm ci` to accept the lockfile; only
# the runner's dependencies are installed.
COPY package.json package-lock.json ./
COPY apps/runner/package.json apps/runner/
COPY apps/web/package.json apps/web/
COPY packages/dto/package.json packages/dto/
RUN npm ci --workspace @wetestcase/runner --include-workspace-root=false --ignore-scripts \
    && npm cache clean --force

COPY packages/dto packages/dto
COPY apps/runner apps/runner

# pwuser ships with the image. Runs execute scripts QA wrote, so not as root.
RUN mkdir -p /repo/apps/runner/.work && chown -R pwuser:pwuser /repo/apps/runner/.work
USER pwuser
WORKDIR /repo/apps/runner

ENV NODE_ENV=production
CMD ["node", "src/index.ts"]
