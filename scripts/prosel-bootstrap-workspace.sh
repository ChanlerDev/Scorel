#!/usr/bin/env bash
set -euo pipefail

REMOTE_URL="${PROSEL_GIT_REMOTE:-git@github.com:ChanlerDev/Prosel.git}"
REMOTE_BRANCH="${PROSEL_GIT_BRANCH:-main}"
WORKSPACE_DIR="${SYMPHONY_WORKSPACE:-$PWD}"

if [ -z "$REMOTE_URL" ]; then
  echo "PROSEL_GIT_REMOTE is not set." >&2
  exit 1
fi

mkdir -p "$WORKSPACE_DIR"

if [ -d "$WORKSPACE_DIR/.git" ]; then
  cd "$WORKSPACE_DIR"

  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$REMOTE_URL"
  else
    git remote add origin "$REMOTE_URL"
  fi

  git fetch origin "$REMOTE_BRANCH"

  if [ -n "$(git status --porcelain)" ]; then
    echo "Skipping git sync because workspace has uncommitted changes." >&2
    exit 0
  fi

  ahead_count="$(git rev-list --left-right --count HEAD...origin/"$REMOTE_BRANCH" | awk '{print $1}')"
  if [ "${ahead_count:-0}" -gt 0 ]; then
    echo "Skipping git sync because workspace has local commits ahead of origin/$REMOTE_BRANCH." >&2
    exit 0
  fi

  git checkout -B "$REMOTE_BRANCH" "origin/$REMOTE_BRANCH"
else
  cd "$WORKSPACE_DIR"
  git init -b "$REMOTE_BRANCH"
  git remote add origin "$REMOTE_URL"
  git fetch origin "$REMOTE_BRANCH"
  git checkout -B "$REMOTE_BRANCH" "origin/$REMOTE_BRANCH"
fi
