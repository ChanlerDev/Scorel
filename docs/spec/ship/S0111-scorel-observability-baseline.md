# S0111: Scorel Session Observability Summary

## Goal

Make token usage, selected model, and cost estimate available as session-level observability data, independent of `scorel run`.

Interactive CLI, GUI, `scorel run`, and external harness adapters should all be able to read the same session observation summary instead of each caller rescanning session JSONL or inventing a separate total.

## Scope

- Keep append-only session JSONL as the source of truth.
- Add a derived session summary cache beside the session JSONL:
  - `<sessionId>.summary.json`;
  - format `scorel-session-observation-v1`;
  - `usage`, `model`, `cost`, `eventCount`, `updatedAt`, and `sourceSessionJsonl`.
- Maintain the summary from the generic `JsonlSession` create/load/append path, not from `scorel run`.
- Let `scorel run` report metadata reference the session summary cache instead of owning observability totals.
- Keep cache write failures non-fatal because the JSONL event stream remains authoritative.

## Not In Scope

- Implementing the S0110 Harbor compatibility files.
- Network upload to any benchmark or tracing service.
- OpenTelemetry integration.
- Budget enforcement or spend limits.
- Per-turn metrics cache.
- A GUI rendering surface for the summary.

## Acceptance Criteria

- Creating a session writes an empty `<sessionId>.summary.json`.
- Appending assistant messages with usage updates the summary totals.
- Loading a session rebuilds the summary from JSONL if the cache is missing or stale.
- `scorel run` summary `reports` includes `sessionSummary`.
- The summary does not include API keys or provider request payloads.

## Status

Done.
