# S0112: Observability Sync Assets

## Goal

Make Scorel observability local-first and syncable.

Every session should produce local observation assets from the append-only JSONL source of truth. External systems are sync targets, not the primary store. Langfuse sync must be replace/upsert-style by stable turn trace and observation ids. OpenTelemetry sync must avoid duplicate metrics by exporting only events after the local per-target checkpoint.

## Scope

- Define a session observation asset derived from session JSONL:
  - stable `assetId` based on device, project, and session ids;
  - `revision` based on current seq and event content;
  - session summary, trajectory events, and source paths.
- Add deterministic Langfuse ingestion payload generation:
  - a Scorel session maps to a Langfuse `sessionId`;
  - each user turn maps to one stable Langfuse trace id so Langfuse Sessions can replay the conversation as multiple traces;
  - assistant messages map to stable `generation` observations with trace input/output plus `usageDetails` and `costDetails`;
  - tool results map to stable `TOOL` observations under the related generation;
  - sync updates use the same body ids and revision-specific ingestion envelope ids so re-sync updates the same turn traces/observations instead of duplicating prior turns.
- Add OpenTelemetry delta export planning:
  - maintain per-target sync state;
  - export only events with `seq > lastExportedSeq`;
  - represent each delta as OTLP HTTP JSON traces, metrics, and logs;
  - update the checkpoint after a successful export.
- Add a CLI manual sync entry:
  - `scorel observe sync --session <id> --target langfuse|otel`;
  - `--out <path>` writes the generated payload for inspection or external upload without marking the target as synced when no upload occurs;
  - Langfuse sync uploads to `/api/public/ingestion` when enabled credentials are present in device config;
  - OpenTelemetry sync uploads the delta to `/v1/traces`, `/v1/metrics`, and `/v1/logs` when an OTLP HTTP endpoint is configured;
  - sync state is stored under the Scorel state dir.
- Extend config schema with observability sync settings.
- Add automatic post-turn sync when `[observability.sync]` is enabled with `mode = "auto"`:
  - future Host-backed chat turns sync after completion;
  - sync failures are logged as diagnostics and do not fail the chat turn;
  - Langfuse sync regenerates the full trace payload with stable trace/observation ids;
  - OpenTelemetry sync exports only the checkpointed event delta.
- Add a GUI Settings entry for the same device-scoped observability config:
  - local observation asset retention;
  - automatic sync toggle/mode;
  - Langfuse enablement, host, public key, and secret key;
  - OpenTelemetry enablement and OTLP HTTP endpoint.

## Product Boundary

Local session JSONL remains authoritative. Observation assets, Langfuse payloads, OpenTelemetry deltas, and sync state are all derived.

Langfuse is the session-level review surface. Scorel uses Langfuse `sessionId` to group turn traces, and stable ids plus full regenerated payloads so a later sync of the same session updates the existing turn traces/observations.

OpenTelemetry is not a full-session replacement surface. Generic OTLP backends do not guarantee overwrite semantics for historical metrics, so Scorel exports deltas by checkpoint instead of replaying old totals by default. Each delta carries three OTLP signals: spans for the session/events, metrics for event and token deltas, and logs for safe event metadata. Raw prompt text, provider API keys, and full tool output are not included in OTLP payloads by default.

## Not In Scope

- GUI observation inspector.
- OTLP protobuf exporter; S0112 uses OTLP HTTP JSON.
- Langfuse score/evaluation sync.
- Uploading raw API keys, bearer tokens, full provider payloads, or full tool outputs by default.

## Acceptance Criteria

- Config accepts `[observability]`, `[observability.sync]`, `[observability.langfuse]`, and `[observability.otel]` with known keys, and ignores unknown config keys/sections so optional or forward-looking config never makes the app unusable.
- GUI Settings exposes observability controls and writes the same device-scoped config through daemon IPC for local and Relay devices.
- `scorel observe sync --session <id> --target langfuse --out <file>` writes a Langfuse ingestion payload whose turn trace ids are stable across revisions while ingestion envelope ids change when the session grows.
- `scorel observe sync --session <id> --target langfuse` uploads that payload to Langfuse when `[observability.langfuse]` has `enabled = true`, `publicKey`, and `secretKey`.
- Re-syncing the same session after another chat turn targets the same Langfuse turn trace/observation body ids for existing turns and only creates new turn traces for new user turns.
- `scorel observe sync --session <id> --target otel --out <file>` writes only events after the target checkpoint without advancing the checkpoint unless an OTLP upload is also performed.
- `scorel observe sync --session <id> --target otel` uploads traces, metrics, and logs to OTLP HTTP when `[observability.otel]` has `enabled = true` and `endpoint`.
- A second OTel sync without new session events exports an empty delta and does not duplicate earlier metrics.
- Host-backed chat turns automatically sync enabled targets after completion when `[observability.sync]` has `enabled = true` and `mode = "auto"`.
- Generated sync payloads do not include provider API keys or config secrets.

## Testing

Add focused tests for:

- Langfuse stable turn trace ids, generation/tool observation ids, current `usageDetails`/`costDetails`, and revision-specific event envelopes.
- Langfuse ingestion upload with Basic Auth, without leaking provider API keys.
- OTel checkpointed delta behavior.
- OTel inspect-only `--out` behavior does not advance the checkpoint.
- OTel OTLP HTTP upload to `/v1/traces`, `/v1/metrics`, and `/v1/logs`.
- Daemon post-turn automatic sync when observability sync mode is `auto`.
- CLI `observe sync` output and sync-state updates.
- Config parsing for observability sections, including forward-compatible ignored unknown keys.
- GUI observability settings rendering and device config write-through.

Run:

```bash
pnpm --filter @scorel/core test -- observability
pnpm --filter @scorel/core test -- config
pnpm --filter @scorel/app-cli test -- index
pnpm --filter @scorel/core typecheck
pnpm --filter @scorel/app-cli typecheck
```

Before completion, run:

```bash
pnpm typecheck && pnpm test
```

## Affected Paths

- `packages/core/src/observability/`
- `packages/core/src/config/index.ts`
- `packages/core/src/index.ts`
- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`
- `apps/gui/src/main.ts`
- `apps/gui/src/preload.ts`
- `apps/gui/src/renderer/settings/`
- `docs/ROADMAP.md`
- `docs/spec/ship/S0112-observability-sync-assets.md`

## Risks

- Langfuse ingestion APIs can evolve toward OpenTelemetry-first ingestion. Mitigation: keep Scorel's canonical asset and id mapping independent of transport details.
- OTel users may expect historical replay to overwrite metrics. Mitigation: default to checkpointed deltas and reserve full replay for a future explicit, warning-gated command.
- Observation assets can grow with long sessions. Mitigation: this spec keeps payload generation explicit/manual and does not add a background uploader yet.

## Status

Done.
