#!/usr/bin/env bash
# Daily update of the public jobs repo, run by cron on the server that hosts
# the API. Lives at the root of the repo's clone, next to generate.mjs.
#
#   JOBS_API=http://localhost:3333/api/jobs ./update.sh
#
# Pushes with the repo's own deploy key (~/.ssh/remote_jobs_deploy).
set -euo pipefail

cd "$(dirname "$0")"
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/remote_jobs_deploy -o IdentitiesOnly=yes"

git pull --quiet --rebase
node generate.mjs .
git add README.md JUNIOR.md
if git diff --cached --quiet; then
  echo "$(date -u +%FT%TZ) no change"
  exit 0
fi
git -c user.name="Angel Nikolov" -c user.email="2675259+angelnikolov@users.noreply.github.com" \
  commit --quiet -m "Update job tables"
git push --quiet
echo "$(date -u +%FT%TZ) updated"
