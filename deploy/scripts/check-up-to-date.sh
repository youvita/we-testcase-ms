#!/usr/bin/env bash
# Refuse to deploy a checkout that is missing commits from the base branch.
#
# What this exists to stop: on 2026-11-12 a deploy ran from a branch forty
# commits behind main, carrying a migration that created an enum main had
# already created. The app could not start, and nothing in the deploy path had
# said a word about the checkout being stale — not git, not compose, not the
# build.
#
# The rule is "HEAD contains the base branch", not "HEAD is the base branch":
# deploying a feature branch that is up to date with main is a normal thing to
# want, and this leaves it alone.
#
# It refuses only when it can prove the checkout is behind. No git, no remote,
# an unreachable origin, a shallow clone it cannot reason about — those warn
# and let the deploy through, because a check that cannot see is no reason to
# stop a release.
#
# Deliberate rollback:
#   ALLOW_STALE_DEPLOY=1 npm run docker:stack:up
set -uo pipefail

BASE_BRANCH="${DEPLOY_BASE_BRANCH:-main}"
REMOTE="${DEPLOY_REMOTE:-origin}"

skip() {
  echo "==> Staleness check skipped: $*"
  exit 0
}

command -v git >/dev/null 2>&1 || skip "git is not installed"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || skip "not a git checkout"
git remote get-url "$REMOTE" >/dev/null 2>&1 || skip "no '${REMOTE}' remote"

# Give up rather than hang a deploy on a stalled network.
if ! git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=15 \
     fetch --quiet --no-tags "$REMOTE" "$BASE_BRANCH" 2>/dev/null; then
  skip "could not reach ${REMOTE} (deploying what is here)"
fi

base="$(git rev-parse FETCH_HEAD 2>/dev/null)" || skip "could not read ${REMOTE}/${BASE_BRANCH}"
head="$(git rev-parse HEAD 2>/dev/null)" || skip "could not read HEAD"

if [[ "$base" == "$head" ]]; then
  echo "==> Checkout is ${REMOTE}/${BASE_BRANCH} @ ${head:0:8}"
  exit 0
fi

# 0 = HEAD already contains the base branch, 1 = behind, anything else = the
# question could not be answered (a shallow clone, usually).
git merge-base --is-ancestor "$base" "$head" 2>/dev/null
case "$?" in
  0)
    echo "==> Checkout is ahead of ${REMOTE}/${BASE_BRANCH} @ ${head:0:8} — nothing missing"
    exit 0
    ;;
  1) ;;
  *) skip "could not compare with ${REMOTE}/${BASE_BRANCH} (shallow clone?)" ;;
esac

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
[[ "$branch" == "HEAD" ]] && branch="(detached)"
behind="$(git rev-list --count "${head}..${base}" 2>/dev/null || echo '?')"

if [[ -n "${ALLOW_STALE_DEPLOY:-}" ]]; then
  echo "==> ALLOW_STALE_DEPLOY is set: deploying ${branch}, ${behind} commit(s) behind ${REMOTE}/${BASE_BRANCH}." >&2
  exit 0
fi

cat >&2 <<EOF

Refusing to deploy: this checkout is ${behind} commit(s) behind ${REMOTE}/${BASE_BRANCH}.

  checkout                 ${branch} @ ${head:0:8}
  ${REMOTE}/${BASE_BRANCH}             ${base:0:8}

It would put code older than what is live back on the server, and a migration
it carries can collide with one the database already has.

  git checkout ${BASE_BRANCH} && git pull --ff-only     # deploy the base branch
  git merge ${REMOTE}/${BASE_BRANCH}                       # or bring this branch up to date

Rolling back on purpose?  ALLOW_STALE_DEPLOY=1 npm run docker:stack:up

EOF
exit 1
