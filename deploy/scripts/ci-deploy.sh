#!/usr/bin/env bash
# GitHub Actions deploy on the Mac mini self-hosted runner.
# Links host secrets into this checkout, then rebuilds the app only.
# Never starts or stops Cloudflare.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ENV_FILE="${DEPLOY_ENV_NAME:-.env.production}"

export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.docker/bin:${PATH:-/usr/bin:/bin}"

resolve_env() {
  if [[ -f "$ENV_FILE" || -L "$ENV_FILE" ]]; then
    return 0
  fi

  local candidates=()
  if [[ -n "${DEPLOY_ENV_FILE:-}" ]]; then
    candidates+=("${DEPLOY_ENV_FILE}")
  fi

  local repo_name
  repo_name="$(basename "$ROOT")"
  candidates+=(
    "${HOME}/Apps/${repo_name}/${ENV_FILE}"
    "${HOME}/Projects/${repo_name}/${ENV_FILE}"
  )

  local src
  for src in "${candidates[@]}"; do
    [[ -f "$src" ]] || continue
    local src_dir
    src_dir="$(cd "$(dirname "$src")" && pwd)"
    if [[ "$src_dir" == "$ROOT" ]]; then
      continue
    fi
    echo "==> Using host env: $src"
    ln -sfn "$src" "$ENV_FILE"
    return 0
  done
  return 1
}

if ! resolve_env; then
  echo "Missing ${ENV_FILE} in ${ROOT}." >&2
  echo "Keep production secrets on the Mac mini (not in GitHub) and either:" >&2
  echo "  - set repository variable DEPLOY_ENV_FILE to the absolute path, or" >&2
  echo "  - keep the file at ~/Apps/$(basename "$ROOT")/${ENV_FILE} or ~/Projects/$(basename "$ROOT")/${ENV_FILE}" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running on this Mac mini. Start Docker Desktop and re-run." >&2
  exit 1
fi

echo "==> Deploying from $(pwd) @ ${GITHUB_SHA:-unknown}"
npm run docker:stack:up
