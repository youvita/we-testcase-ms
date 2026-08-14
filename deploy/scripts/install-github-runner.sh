#!/usr/bin/env bash
# One-time: install a GitHub Actions self-hosted runner as a user LaunchAgent.
# Run this on the Mac mini as the same user that runs Docker Desktop (not root).
#
# Org runner (preferred — one runner for we-testcase-ms and secure-scanner):
#   ./deploy/scripts/install-github-runner.sh \
#     --url https://github.com/youvita \
#     --token <registration-token>
#
# Repo runner:
#   ./deploy/scripts/install-github-runner.sh \
#     --url https://github.com/youvita/we-testcase-ms \
#     --token <registration-token>
#
# Get a token from:
#   Org:  https://github.com/organizations/ORG/settings/actions/runners/new
#   Repo: https://github.com/OWNER/REPO/settings/actions/runners/new
set -euo pipefail

URL=""
TOKEN=""
RUNNER_NAME="${RUNNER_NAME:-mac-mini}"
RUNNER_DIR="${RUNNER_DIR:-${HOME}/actions-runner}"
LABELS="macmini"

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \?//'
  echo
  echo "Options:"
  echo "  --url URL       GitHub org or repo URL (required)"
  echo "  --token TOKEN   Runner registration token (required)"
  echo "  --name NAME     Runner name (default: mac-mini)"
  echo "  --dir PATH      Install directory (default: ~/actions-runner)"
  echo "  -h, --help      Show this help"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --name) RUNNER_NAME="${2:-}"; shift 2 ;;
    --dir) RUNNER_DIR="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$URL" || -z "$TOKEN" ]]; then
  usage
  echo >&2
  echo "Both --url and --token are required." >&2
  exit 1
fi

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Do not run this as root. The runner must use the same user as Docker Desktop." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 && [[ ! -x /usr/local/bin/docker ]] && [[ ! -x /opt/homebrew/bin/docker ]]; then
  echo "Docker CLI not found. Install Docker Desktop first." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) RUNNER_ARCH="osx-arm64" ;;
  x86_64) RUNNER_ARCH="osx-x64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

if [[ -f "${RUNNER_DIR}/.runner" ]]; then
  echo "A runner is already configured at ${RUNNER_DIR}."
  echo "Reuse it (org runner) or pick another --dir for a second repo runner."
  exit 1
fi

echo "==> Latest GitHub Actions runner (${RUNNER_ARCH})"
LATEST="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
  | sed -n 's/.*"tag_name": "v\([^"]*\)".*/\1/p' \
  | head -1)"
if [[ -z "$LATEST" ]]; then
  echo "Could not resolve the latest actions/runner release." >&2
  exit 1
fi

TARBALL="actions-runner-${RUNNER_ARCH}-${LATEST}.tar.gz"
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [[ ! -f "./config.sh" ]]; then
  echo "==> Downloading ${TARBALL}"
  curl -fsSL -o "$TARBALL" \
    "https://github.com/actions/runner/releases/download/v${LATEST}/${TARBALL}"
  tar xzf "$TARBALL"
  rm -f "$TARBALL"
fi

echo "==> Configuring runner ${RUNNER_NAME} → ${URL}"
./config.sh --unattended \
  --url "$URL" \
  --token "$TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$LABELS" \
  --work _work \
  --replace

echo "==> Installing user LaunchAgent"
./svc.sh install
./svc.sh start

cat <<EOF

================================================================
  GitHub Actions runner is installed
================================================================
  Directory: ${RUNNER_DIR}
  Name:      ${RUNNER_NAME}
  Labels:    self-hosted, macOS, ${RUNNER_ARCH##osx-}, ${LABELS}
  Service:   ./svc.sh status   (from ${RUNNER_DIR})

  Keep Docker Desktop running. Deploys rebuild the app only;
  they do not restart the Cloudflare tunnel.

  Optional — if .env.production is not in ~/Apps or ~/Projects:
    GitHub repo → Settings → Variables → Actions
    DEPLOY_ENV_FILE = /absolute/path/to/.env.production
================================================================
EOF
