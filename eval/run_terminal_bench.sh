#!/usr/bin/env bash
set -euo pipefail

EVAL_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd -- "$EVAL_DIR/.." && pwd)
ENV_FILE=${SCOREL_EVAL_ENV_FILE:-"$EVAL_DIR/.env"}

if [[ ! -f "$ENV_FILE" ]]; then
  printf 'Missing %s. Copy eval/.env.example to eval/.env and fill in the placeholders.\n' "$ENV_FILE" >&2
  exit 2
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
export -n SCOREL_EVAL_PROVIDER SCOREL_EVAL_BASE_URL SCOREL_EVAL_API_KEY SCOREL_EVAL_MODEL

require_value() {
  local name=$1
  if [[ -z ${!name:-} || ${!name} == replace-* ]]; then
    printf '%s must be set to a non-placeholder value in %s.\n' "$name" "$ENV_FILE" >&2
    exit 2
  fi
}

require_value SCOREL_EVAL_PROVIDER
require_value SCOREL_EVAL_BASE_URL
require_value SCOREL_EVAL_API_KEY
require_value SCOREL_EVAL_MODEL

SCOREL_EVAL_API=${SCOREL_EVAL_API:-openai-completions}
SCOREL_EVAL_REASONING_EFFORT=${SCOREL_EVAL_REASONING_EFFORT:-max}
SCOREL_EVAL_DATASET=${SCOREL_EVAL_DATASET:-terminal-bench/terminal-bench-2-1}
SCOREL_EVAL_ENVIRONMENT=${SCOREL_EVAL_ENVIRONMENT:-daytona}
SCOREL_EVAL_ATTEMPTS=${SCOREL_EVAL_ATTEMPTS:-2}
SCOREL_EVAL_CONCURRENCY=${SCOREL_EVAL_CONCURRENCY:-3}
SCOREL_EVAL_UPLOAD_PRIVATE=${SCOREL_EVAL_UPLOAD_PRIVATE:-false}
SCOREL_EVAL_JOBS_DIR=${SCOREL_EVAL_JOBS_DIR:-"$EVAL_DIR/jobs"}

RUN_DIR="$SCOREL_EVAL_JOBS_DIR/$(date -u +%Y-%m-%dT%H-%M-%SZ)"
mkdir -p "$RUN_DIR"
printf 'Harbor job directory: %s\n' "$RUN_DIR"

SCRUBBED=false
scrub_run() {
  if [[ "$SCRUBBED" == false && -d "$RUN_DIR" ]]; then
    SCOREL_EVAL_API_KEY="$SCOREL_EVAL_API_KEY" \
    SCOREL_EVAL_BASE_URL="$SCOREL_EVAL_BASE_URL" \
    SCOREL_EVAL_PROVIDER="$SCOREL_EVAL_PROVIDER" \
      python3 "$EVAL_DIR/scrub_harbor_job.py" "$RUN_DIR"
    SCRUBBED=true
  fi
}
trap scrub_run EXIT

set +e
PYTHONPATH="$REPO_DIR${PYTHONPATH:+:$PYTHONPATH}" harbor run \
  --dataset "$SCOREL_EVAL_DATASET" \
  --agent-import-path eval.scorel_harbor_agent:ScorelAgent \
  --model "$SCOREL_EVAL_PROVIDER/$SCOREL_EVAL_MODEL" \
  --agent-kwarg "provider=$SCOREL_EVAL_PROVIDER" \
  --agent-kwarg "api=$SCOREL_EVAL_API" \
  --agent-kwarg "base_url=$SCOREL_EVAL_BASE_URL" \
  --agent-kwarg "api_key=$SCOREL_EVAL_API_KEY" \
  --agent-kwarg "reasoning_effort=$SCOREL_EVAL_REASONING_EFFORT" \
  --env "$SCOREL_EVAL_ENVIRONMENT" \
  --n-attempts "$SCOREL_EVAL_ATTEMPTS" \
  --n-concurrent "$SCOREL_EVAL_CONCURRENCY" \
  --jobs-dir "$RUN_DIR" \
  --yes
RUN_STATUS=$?
set -e

scrub_run

if [[ "$SCOREL_EVAL_UPLOAD_PRIVATE" == true ]]; then
  harbor upload "$RUN_DIR" --private --concurrency "$SCOREL_EVAL_CONCURRENCY" --yes
fi

trap - EXIT
exit "$RUN_STATUS"
