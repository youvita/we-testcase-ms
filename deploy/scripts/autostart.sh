#!/usr/bin/env bash
# Bring the stack back after the Mac mini restarts or Docker Desktop crashes.
#
# Run by the LaunchAgent from install-autostart.sh at login and every few
# minutes. It never builds or recreates anything: it opens Docker Desktop if it
# is closed, then starts the containers below that are stopped with exit code
# 255 — what Docker leaves behind when it dies under them, and what the restart
# policy then fails to recover. A container stopped on purpose (`docker stop`,
# exit 0/137/143) is left alone.
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.docker/bin:${PATH:-/usr/bin:/bin}"

# Postgres first so the app finds its database. Missing containers are skipped
# (the runner and the tunnel are optional).
CONTAINERS="${AUTOSTART_CONTAINERS:-wetestcase-postgres wetestcase-claude-bridge wetestcase-app wetestcase-runner macmini-edge macmini-tunnel}"
DOCKER_WAIT_SECONDS="${DOCKER_WAIT_SECONDS:-300}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [autostart] $*"; }

if ! docker info >/dev/null 2>&1; then
  log "Docker is not running; opening Docker Desktop"
  open -ga Docker || { log "could not open Docker Desktop"; exit 1; }
  waited=0
  until docker info >/dev/null 2>&1; do
    if [[ "$waited" -ge "$DOCKER_WAIT_SECONDS" ]]; then
      log "Docker did not start within ${DOCKER_WAIT_SECONDS}s"
      exit 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
  log "Docker is up after ${waited}s"
  # Give Docker's own restart policies a moment before stepping in.
  sleep 20
fi

started=0
for name in $CONTAINERS; do
  state="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$name" 2>/dev/null)" || continue
  if [[ "$state" == "exited 255" ]]; then
    log "starting ${name} (was exited 255)"
    if docker start "$name" >/dev/null; then
      started=$((started + 1))
    else
      log "failed to start ${name}"
    fi
    # The app's healthcheck waits on Postgres; give it a head start.
    [[ "$name" == "wetestcase-postgres" ]] && sleep 10
  fi
done

if [[ "$started" -gt 0 ]]; then
  log "started ${started} container(s)"
  if [[ " $CONTAINERS " == *" macmini-tunnel "* ]] && docker inspect macmini-tunnel >/dev/null 2>&1; then
    sleep 20
    url="$(docker logs --since 2m macmini-tunnel 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)"
    [[ -n "$url" ]] && log "public URL is now ${url}/cases/ (share the new link)"
  fi
fi
