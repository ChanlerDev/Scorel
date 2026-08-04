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
SCOREL_EVAL_TIMEOUT_MULTIPLIER=${SCOREL_EVAL_TIMEOUT_MULTIPLIER:-4}
SCOREL_EVAL_AGENT_TIMEOUT_MULTIPLIER=${SCOREL_EVAL_AGENT_TIMEOUT_MULTIPLIER:-4}
SCOREL_EVAL_AGENT_SETUP_TIMEOUT_MULTIPLIER=${SCOREL_EVAL_AGENT_SETUP_TIMEOUT_MULTIPLIER:-2}
SCOREL_EVAL_ENVIRONMENT_BUILD_TIMEOUT_MULTIPLIER=${SCOREL_EVAL_ENVIRONMENT_BUILD_TIMEOUT_MULTIPLIER:-3}
SCOREL_EVAL_MAX_RETRIES=${SCOREL_EVAL_MAX_RETRIES:-2}
SCOREL_EVAL_UPLOAD_PRIVATE=${SCOREL_EVAL_UPLOAD_PRIVATE:-false}
SCOREL_EVAL_JOBS_DIR=${SCOREL_EVAL_JOBS_DIR:-"$EVAL_DIR/jobs"}

if [[ "$SCOREL_EVAL_ENVIRONMENT" == daytona ]]; then
  if [[ -n ${DAYTONA_API_KEY:-} && ${DAYTONA_API_KEY} != replace-* ]]; then
    export DAYTONA_API_KEY
  elif [[ -n ${DAYTONA_JWT_TOKEN:-} && -n ${DAYTONA_ORGANIZATION_ID:-} ]]; then
    export DAYTONA_JWT_TOKEN DAYTONA_ORGANIZATION_ID
  else
    printf 'Daytona requires DAYTONA_API_KEY or DAYTONA_JWT_TOKEN plus DAYTONA_ORGANIZATION_ID in %s.\n' "$ENV_FILE" >&2
    exit 2
  fi
fi

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
  --timeout-multiplier "$SCOREL_EVAL_TIMEOUT_MULTIPLIER" \
  --agent-timeout-multiplier "$SCOREL_EVAL_AGENT_TIMEOUT_MULTIPLIER" \
  --agent-setup-timeout-multiplier "$SCOREL_EVAL_AGENT_SETUP_TIMEOUT_MULTIPLIER" \
  --environment-build-timeout-multiplier "$SCOREL_EVAL_ENVIRONMENT_BUILD_TIMEOUT_MULTIPLIER" \
  --max-retries "$SCOREL_EVAL_MAX_RETRIES" \
  --jobs-dir "$RUN_DIR" \
  --yes
RUN_STATUS=$?
set -e

scrub_run

UPLOAD_STATUS=0
if [[ "$SCOREL_EVAL_UPLOAD_PRIVATE" == true ]]; then
  mapfile -t JOB_DIRS < <(
    find "$RUN_DIR" -mindepth 1 -maxdepth 1 -type d \
      -exec test -f '{}/config.json' ';' \
      -exec test -f '{}/result.json' ';' \
      -print
  )
  if [[ ${#JOB_DIRS[@]} -eq 0 ]]; then
    printf 'No completed Harbor job directory found under %s; private upload skipped.\n' "$RUN_DIR" >&2
    UPLOAD_STATUS=1
  else
    for JOB_DIR in "${JOB_DIRS[@]}"; do
      harbor upload "$JOB_DIR" --private --concurrency "$SCOREL_EVAL_CONCURRENCY" --yes || UPLOAD_STATUS=$?
    done
  fi
fi

trap - EXIT
if [[ "$UPLOAD_STATUS" -ne 0 ]]; then
  exit "$UPLOAD_STATUS"
fi
exit "$RUN_STATUS"
