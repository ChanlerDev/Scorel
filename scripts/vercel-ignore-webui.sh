#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${VERCEL_GIT_PREVIOUS_SHA:-}" || -z "${VERCEL_GIT_COMMIT_SHA:-}" ]]; then
  echo "Vercel git SHAs unavailable; build WebUI."
  exit 1
fi

if git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" "$VERCEL_GIT_COMMIT_SHA" -- \
  apps/webui \
  packages/client \
  packages/protocol \
  package.json \
  pnpm-lock.yaml \
  pnpm-workspace.yaml \
  tsconfig.base.json \
  vercel.json; then
  echo "No WebUI-impacting changes detected; skip build."
  exit 0
fi

echo "WebUI-impacting changes detected; build WebUI."
exit 1
