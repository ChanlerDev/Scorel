#!/usr/bin/env bash
set -euo pipefail

BRANCH="snapshots/docs"
REMOTE="origin"
DOCS_DIR="docs"

# --- Fetch latest snapshot branch ---
echo "Fetching $REMOTE/$BRANCH..."
git fetch "$REMOTE" "$BRANCH" --quiet 2>/dev/null || {
  echo "Error: remote branch $BRANCH not found. Run 'pnpm docs:push' first." >&2
  exit 1
}

# --- Extract docs/ from snapshot into working directory ---
echo "Restoring $DOCS_DIR/ from $REMOTE/$BRANCH..."
git checkout "$REMOTE/$BRANCH" -- "$DOCS_DIR"

# Reset index so docs/ stays untracked (not staged)
git reset --quiet -- "$DOCS_DIR"

echo "Done. $DOCS_DIR/ updated from $REMOTE/$BRANCH."
