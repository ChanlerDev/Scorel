#!/usr/bin/env bash
set -euo pipefail

BRANCH="snapshots/docs"
REMOTE="origin"
BASE_REF="$REMOTE/main"
DOCS_DIR="docs"

# --- Preflight ---
if [ ! -d "$DOCS_DIR" ]; then
  echo "Error: $DOCS_DIR/ directory not found." >&2
  exit 1
fi

if [ -z "$(ls -A "$DOCS_DIR")" ]; then
  echo "Error: $DOCS_DIR/ is empty." >&2
  exit 1
fi

# --- Fetch latest main ---
echo "Fetching $BASE_REF..."
git fetch "$REMOTE" main --quiet

BASE_COMMIT=$(git rev-parse "$BASE_REF")
BASE_TREE=$(git rev-parse "$BASE_REF^{tree}")
TIMESTAMP=$(date +%Y-%m-%dT%H:%M:%S%z)
SHORT_SHA=$(git rev-parse --short "$BASE_COMMIT")

# --- Build new tree with docs/ added ---
# Use a temporary index to avoid touching the working tree
export GIT_INDEX_FILE=$(mktemp)
trap 'rm -f "$GIT_INDEX_FILE"' EXIT

# Start from base tree
git read-tree "$BASE_TREE"

# Add current working directory docs/ into the temporary index
git add --force "$DOCS_DIR"

# Write the tree object
NEW_TREE=$(git write-tree)

# --- Create commit ---
COMMIT_MSG="docs: snapshot $TIMESTAMP

Source: main@$SHORT_SHA"

NEW_COMMIT=$(git commit-tree "$NEW_TREE" -p "$BASE_COMMIT" -m "$COMMIT_MSG")

# --- Update branch ref ---
git update-ref "refs/heads/$BRANCH" "$NEW_COMMIT"

# --- Push ---
echo "Pushing $BRANCH..."
git push --force-with-lease "$REMOTE" "$BRANCH"

echo "Done. $BRANCH -> $SHORT_SHA + docs/"
