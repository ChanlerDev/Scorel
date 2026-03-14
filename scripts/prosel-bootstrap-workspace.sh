#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${PROSEL_SOURCE_DIR:-$HOME/Prosel}"
WORKSPACE_DIR="${SYMPHONY_WORKSPACE:-$PWD}"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Prosel source directory does not exist: $SOURCE_DIR" >&2
  exit 1
fi

if [ "$SOURCE_DIR" = "$WORKSPACE_DIR" ]; then
  echo "Refusing to sync Prosel source into itself: $SOURCE_DIR" >&2
  exit 1
fi

has_source_content=0
if find "$SOURCE_DIR" -mindepth 1 -maxdepth 1 ! -name '.git' | read -r _; then
  has_source_content=1
fi

if [ "$has_source_content" -eq 0 ]; then
  echo "Prosel source directory is empty; leaving workspace untouched for initial bootstrap." >&2
  exit 0
fi

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude 'dist' \
    --exclude 'coverage' \
    --exclude '.turbo' \
    "$SOURCE_DIR"/ "$WORKSPACE_DIR"/
else
  tar -C "$SOURCE_DIR" \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='.next' \
    --exclude='dist' \
    --exclude='coverage' \
    --exclude='.turbo' \
    -cf - . | tar -C "$WORKSPACE_DIR" -xf -
fi
