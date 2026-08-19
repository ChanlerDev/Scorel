# S0121: Provider Retry Reliability

## Goal

Implement Codex-style reliable retry for the provider call chain: bounded exponential backoff with jitter, Retry-After header support, correct classification of retryable vs non-retryable errors, and safe retry semantics that never blindly replay after visible output or tool execution.

## Context

The existing runtime (`#runProviderTurn`) has a narrow retry that only handles one specific premature-stream-end error string, retries at most once, and has no backoff, jitter, or Retry-After handling. The pi-ai provider adapter (`pi-ai.ts`) passes no retry options to the pi-ai library. All other provider errors (429, 503, network failures, stream interruptions) surface immediately as terminal errors.

## Scope

- Create a provider-neutral retry policy module with error classification, exponential backoff + jitter, and Retry-After support.
- Replace the narrow retry in `ScorelRuntime.#runProviderTurn` with a comprehensive retry loop that uses the new policy.
- Retry only when no visible text has been emitted (thinking-only or empty) — never after text deltas, tool calls, or tool execution.
- Handle both thrown errors and error assistant messages (stopReason "error").
- Respect AbortSignal during backoff sleep.
- Provider-neutral: no provider names, model IDs, base URLs, or benchmark-specific logic.

## Non-Goals

- No HTTP-level retry inside pi-ai (leave pi-ai's `maxRetries: 0` default; retry at Scorel's layer to avoid double-retry).
- No new RawRuntimeEvent types for retry observability (future work).
- No configuration surface for retry policy (fixed sensible defaults; future work).
- No retry after visible text or tool execution.

## Retry Policy

```
maxAttempts: 10      (not counting the initial call)
baseDelayMs: 500     (first retry ~400–500ms with jitter)
maxDelayMs:  30_000  (cap at 30s)
jitterFactor: 0.25   (delay * (1 – random * 0.25), i.e. 75–100% of computed delay)
```

Delay progression (before jitter): 0.5s, 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s, 30s.

## Error Classification

**Non-retryable (fail fast):**
- AbortError / cancellation
- HTTP 400, 401, 403, 404, 422
- `x-should-retry: false` header
- Quota/billing: `insufficient_quota`, `quota exceeded`, `billing`, `GoUsageLimitError`, `FreeUsageLimitError`
- Content filter / safety

**Retryable:**
- HTTP 408, 409, 429, 500, 502, 503, 504, 524
- `x-should-retry: true` header
- Network: `fetch failed`, `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`, `socket hang up`, `connection reset`, `connection refused`, `network error`
- Stream: `Stream ended without`, `stream ended before`, `ended without finish_reason`, `premature`
- Provider: `overloaded`, `rate limit`, `too many requests`, `service unavailable`, `internal error`, `server error`
- Retry guidance: `you can retry your request`, `try your request again`, `please retry your request`
- Unknown errors with no status and no non-retryable pattern → retryable (conservative)

## Acceptance Criteria

- Retry up to 10 times with exponential backoff + jitter.
- Retry-After headers (both `retry-after-ms` and `retry-after`) are respected and capped at `maxDelayMs`.
- 429, 503, and transient network errors are retried.
- Non-retryable errors (auth, content filter, quota) fail immediately.
- No retry after visible text deltas.
- No retry after tool execution (guaranteed by architecture — tools run after `streamTurn` returns).
- AbortSignal cancels backoff sleep immediately.
- Existing runtime tests pass (premature stream end, cancel, tool loop).

## Test Requirements

- Unit tests for error classification (retryable, non-retryable, abort).
- Unit tests for backoff computation (exponential growth, jitter bounds, Retry-After override, max cap).
- Runtime tests: retry on 429 before visible text, no retry after visible text, no retry on non-retryable error, abort during backoff, max attempts exhausted, error assistant message retry.
- All tests use fake providers — no real API keys or provider endpoints.

## Affected Paths

- `packages/core/src/provider/retry.ts` (new)
- `packages/core/src/provider/retry.test.ts` (new)
- `packages/core/src/runtime/index.ts` (modified)
- `packages/core/src/runtime/runtime.test.ts` (modified)
- `packages/core/src/index.ts` (export)
- `docs/spec/runtime.md` (updated)
- `docs/ROADMAP.md` (updated)

## Risks

- Over-retrying could amplify provider load. Mitigated by max 10 attempts, exponential backoff, and jitter.
- Retrying after partial output could corrupt session state. Mitigated by only retrying when no visible text has been emitted.
- Unknown errors might be retried unnecessarily. Mitigated by conservative classification (non-retryable patterns checked first).
