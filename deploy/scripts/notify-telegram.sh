#!/usr/bin/env bash
# Tell Telegram how the deploy went.
#
# The bot token and chat id live in .env.production on this Mac mini, beside
# the other production secrets, so nothing has to be stored in GitHub. Values
# already in the environment win, which keeps repository secrets working for
# anyone who set them up that way.
#
# The workflow calls this with `if: always()`, so it also runs when the deploy
# failed before ci-deploy.sh linked the env file into the checkout. That is why
# it looks in the same places ci-deploy.sh does rather than assuming the link
# is there; it only reads the file, and never creates the link itself.
#
# With no token or chat id it says so and exits 0: a missing notification must
# never turn a deploy that worked into a red build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_NAME="${DEPLOY_ENV_NAME:-.env.production}"

# First readable candidate wins, in the same order as ci-deploy.sh.
env_file=""
for candidate in \
  "${ROOT}/${ENV_NAME}" \
  "${DEPLOY_ENV_FILE:-}" \
  "${HOME}/Apps/$(basename "$ROOT")/${ENV_NAME}" \
  "${HOME}/Projects/$(basename "$ROOT")/${ENV_NAME}"; do
  [[ -n "$candidate" && -r "$candidate" ]] || continue
  env_file="$candidate"
  break
done

# Read one KEY from the env file. Deliberately not `source`: that file is a
# list of secrets, not a script, and sourcing it would run whatever is in it
# and overwrite half the environment on the way through.
read_env() {
  local key="$1" line
  [[ -n "$env_file" ]] || return 0
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$env_file" | tail -1)" || return 0
  line="${line#*=}"
  line="${line%$'\r'}"
  # Strip one layer of matching quotes, as docker compose env files allow.
  if [[ "$line" == \"*\" || "$line" == \'*\' ]]; then
    line="${line:1:${#line}-2}"
  fi
  printf '%s' "$line"
}

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-$(read_env TELEGRAM_BOT_TOKEN)}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-$(read_env TELEGRAM_CHAT_ID)}"

# A value read from a file is not one of Actions' own secrets, so Actions does
# not know to hide it. Tell it to, before anything can echo it.
if [[ -n "${GITHUB_ACTIONS:-}" && -n "$TELEGRAM_BOT_TOKEN" ]]; then
  echo "::add-mask::${TELEGRAM_BOT_TOKEN}"
fi

if [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_CHAT_ID" ]]; then
  echo "Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID${env_file:+ in $env_file}); skipping notification."
  exit 0
fi

if [[ "${JOB_STATUS:-}" == "success" ]]; then
  STATUS="✅ Deployment successful"
else
  STATUS="❌ Deployment failed"
fi

COMMIT_LINE="${COMMIT_MESSAGE%%$'\n'*}"

MESSAGE="$STATUS

Project: ${REPO_NAME:-we-testcase-ms}
Branch: ${BRANCH:-unknown}
By: ${ACTOR:-unknown}
Commit: ${COMMIT_LINE:-(manual run)}"

# Not --fail: a 4xx from Telegram should be visible in the log as the reason,
# not collapsed into "curl exited 22" on an otherwise green deploy.
response="$(curl -sS -X POST \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  -d disable_web_page_preview=true \
  --data-urlencode text="$MESSAGE")" || {
  echo "Could not reach Telegram; deploy result unaffected." >&2
  exit 0
}

case "$response" in
  *'"ok":true'*) echo "Telegram notified." ;;
  *) echo "Telegram refused the message: ${response}" >&2 ;;
esac
