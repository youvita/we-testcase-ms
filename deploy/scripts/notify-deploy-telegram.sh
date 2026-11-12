#!/usr/bin/env bash
# Tell Telegram how the deploy went — on the deploy bot, not the app's.
#
# Two bots, on purpose:
#
#   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID                the app: comments,
#                                                        questions for the PO,
#                                                        the PO's answers
#   DEPLOY_TELEGRAM_BOT_TOKEN / DEPLOY_TELEGRAM_CHAT_ID  this: deploy pass/fail
#
# Nothing here falls back to the app's pair. Sharing one bot is what let the
# two drift apart unnoticed: the deploy half was posting to a chat that
# refused it while the app half worked, and both looked configured.
#
# Either pair of values may come from the environment (GitHub repository
# secrets) or from .env.production on this Mac. The environment wins, so a
# repository secret overrides the file without editing anything here.
#
# It never fails a deploy. A notification that cannot be sent is reported in
# the log and that is all — exit 0 either way.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_NAME="${DEPLOY_ENV_NAME:-.env.production}"

# First readable candidate wins, in the same order as ci-deploy.sh. That script
# links the env file into the CI checkout, but this one runs with `if: always()`
# and so also runs when the deploy failed before the link was made.
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
  if [[ "$line" == \"*\" || "$line" == \'*\' ]]; then
    line="${line:1:${#line}-2}"
  fi
  printf '%s' "$line"
}

TOKEN="${DEPLOY_TELEGRAM_BOT_TOKEN:-$(read_env DEPLOY_TELEGRAM_BOT_TOKEN)}"
CHAT_ID="${DEPLOY_TELEGRAM_CHAT_ID:-$(read_env DEPLOY_TELEGRAM_CHAT_ID)}"

# A value read from a file is not one of Actions' own secrets, so Actions does
# not know to hide it. Tell it to, before anything can echo it.
if [[ -n "${GITHUB_ACTIONS:-}" && -n "$TOKEN" ]]; then
  echo "::add-mask::${TOKEN}"
fi

if [[ -z "$TOKEN" || -z "$CHAT_ID" ]]; then
  echo "No deploy bot configured: set DEPLOY_TELEGRAM_BOT_TOKEN and DEPLOY_TELEGRAM_CHAT_ID"
  echo "as repository secrets, or in ${env_file:-.env.production} on the deploy host."
  echo "(The app's TELEGRAM_* pair is a different bot and is not used here.)"
  exit 0
fi

if [[ "${JOB_STATUS:-}" == "success" ]]; then
  STATUS="✅ Deployment successful"
else
  STATUS="❌ Deployment failed"
fi

COMMIT_LINE="${COMMIT_MESSAGE:-}"
COMMIT_LINE="${COMMIT_LINE%%$'\n'*}"

MESSAGE="$STATUS

Project: ${REPO_NAME:-we-testcase-ms}
Branch: ${BRANCH:-unknown}
By: ${ACTOR:-unknown}
Commit: ${COMMIT_LINE:-(manual run)}"

response="$(curl -sS --max-time 20 -X POST \
  "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -d chat_id="${CHAT_ID}" \
  -d disable_web_page_preview=true \
  --data-urlencode text="$MESSAGE")" || {
  echo "Could not reach Telegram; the deploy result itself is unaffected." >&2
  exit 0
}

# The old inline step ended at the curl above, with no --fail and nothing
# reading the reply. Telegram answers a refusal with 400 and {"ok":false},
# curl exits 0, and the step goes green having sent nothing — which is exactly
# how the deploy notifications were silently missing. Say so instead.
case "$response" in
  *'"ok":true'*)
    echo "Deploy bot notified."
    ;;
  *)
    reason="$(printf '%s' "$response" | sed -n 's/.*"description":"\([^"]*\)".*/\1/p')"
    echo "Telegram refused the deploy notification: ${reason:-$response}" >&2
    echo "Check DEPLOY_TELEGRAM_CHAT_ID, and that the deploy bot is in that chat." >&2
    ;;
esac
exit 0
