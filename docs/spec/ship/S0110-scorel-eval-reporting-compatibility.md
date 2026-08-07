# S0110: Scorel Eval Reporting Compatibility

## Goal

Make `scorel run` produce benchmark-friendly observation data for Harbor / Terminal-Bench jobs: token usage, selected model/provider, estimated cost, event trace, and session report references must be available from deterministic local result files without parsing human stdout.

This spec is about local reporting compatibility and observability data. It is not about Harbor leaderboard upload.

## Evidence Chain

Harbor / Terminal-Bench side:

- Harbor `JobResult.stats` has first-class `n_input_tokens`, `n_cache_tokens`, `n_output_tokens`, and `cost_usd` totals. `TrialResult.compute_token_cost_totals()` aggregates these from agent context data.
- Harbor `AgentContext` is the installed/custom agent's structured observation channel: `n_input_tokens`, `n_cache_tokens`, `n_output_tokens`, `cost_usd`, `rollout_details`, and `metadata`.
- Harbor artifact collection supports the convention directory `/logs/artifacts/` and writes a manifest whose entries record `source`, `destination`, `type`, `status`, and `service`.
- Harbor treats `agent/trajectory.json` as the trajectory convenience path for upload/viewing. Arbitrary extra Scorel reports should remain artifacts or agent metadata unless a Harbor adapter maps them into official context fields.
- Custom installed agents can control their command, environment, context fields, trajectory file, and local output files. They cannot directly control trial ids, task metadata, verifier rewards, timings, exception fields, or upload paths.

Scorel side:

- `scorel run` already writes a summary JSON with status, session id, project id, cwd, state/sessions paths, session JSONL path, elapsed time, error, and captured Scorel events.
- Provider usage already enters Scorel through `ScorelMessage.usage` on assistant messages. The pi-ai bridge maps provider usage into `inputTokens`, `outputTokens`, and `totalTokens`.
- The daemon persists assistant messages with usage in session JSONL and writes diagnostics lines with usage, but `scorel run` does not currently aggregate usage into top-level summary fields.
- Scorel does not currently expose estimated cost. Custom model configs intentionally use zero pi-ai cost, so Scorel needs its own bounded local price table for common model ids and a clear unknown-cost state.

## Scope

- Add a reusable session reporting module that can:
  - aggregate token usage from captured Scorel events;
  - extract model/provider/api metadata from assistant messages and session metadata;
  - estimate cost from a built-in models.dev official-provider price snapshot when a model id is known;
  - report unknown pricing explicitly when the model id is not in the table.
- Extend `scorel run` summary JSON with session-level observation fields:
  - `usage`: input/output/total token totals;
  - `model`: selected Scorel model id, provider model id, provider name, api, and display name when available;
  - `cost`: estimated total cost plus input/output components, currency, pricing source, and known/unknown status;
  - `reports`: local paths for session JSONL, diagnostics log, session files directory, and optional compatibility files.
- Add an optional `--report-dir <path>` for `scorel run` that writes benchmark-friendly report files:
  - `scorel-summary.json`;
  - `scorel-events.jsonl`;
  - `scorel-trajectory.json`;
  - `scorel-metadata.json`.
- Keep `--summary <path>` behavior stable. If both `--summary` and `--report-dir` are present, both are written from the same summary object.
- Keep provider override support simple and safe:
  - `--model <id>` continues to select the run-local model id;
  - summary/reporting can include provider/model identifiers;
  - API keys must never be written to summaries, metadata, events, logs, or report files.

## Product Boundary

The reporting contract is Scorel-owned:

- Scorel summary and report files are the source of truth.
- Harbor adapters can copy, upload, or display those files as Harbor artifacts/metadata.
- Harbor-specific schemas can be added as derived compatibility files only when they can be produced without losing Scorel's native event semantics.

Cost is an estimate:

- The built-in price table is a convenience for common official provider model ids.
- Unknown, malformed, third-party-only, or ambiguous model ids must not receive fake prices.
- Prices are static package data and may drift from provider billing. Reports must name the pricing source/version.
- `official-provider-pricing-2026-08-07` stores USD-per-1M-token input, output, cache-read, and 5-minute cache-write prices keyed by model id from official provider entries.
- Price lookup is model-id only: Scorel first uses the provider-observed model id, then the selected Scorel model id. Provider identity is reported separately but does not participate in price matching.
- If multiple official provider rows expose the same model id with different prices, the snapshot keeps one canonical model-id price rather than encoding provider-specific billing.
- GPT-5.6 long-context pricing is selected per provider request when uncached input plus cache reads and writes exceed 272k tokens; costs are then summed across the run.
- The snapshot includes current official GPT 5.x ids through GPT-5.6, Claude ids through Fable/Opus/Sonnet 5, DeepSeek V4 ids, GLM 5.x ids, and Gemini 3.x text-output ids.

## Not In Scope

- Harbor leaderboard upload.
- Terminal-Bench dataset changes.
- A full tracing backend, metrics daemon, OpenTelemetry exporter, or UI observability dashboard.
- Budget enforcement, spend limits, or stop-on-cost behavior.
- Per-tool token attribution.
- Network submission from Scorel to Harbor.

## Acceptance Criteria

- `scorel run --summary ...` includes top-level `usage`, `model`, `cost`, and `reports`.
- Usage totals are aggregated from assistant/message events and remain correct when a run has multiple assistant messages because of tool calls.
- Unknown model ids keep `cost.known === false` and do not invent a dollar estimate.
- Known model ids produce deterministic cost estimates from Scorel's local price table.
- `--report-dir ...` writes summary, event JSONL, trajectory, and metadata files and records their paths in the summary reports.
- No report file contains provider API keys supplied by `--api-key` / `--apikey` or config.
- Summary/reporting tests use real `scorel run` path with a local HTTP provider stub that returns usage.
- Documentation explains that Harbor should consume local result files as Harbor artifacts/metadata, not rely on upload-specific behavior.

## Testing

- Extend `apps/cli/src/index.test.ts` for:
  - summary usage aggregation;
  - known model cost estimate;
  - unknown model cost boundary;
  - `--report-dir` report file creation;
  - API key redaction in summary/report files.
- Add focused core tests for the reporting/price-table module.

Run:

```bash
pnpm --filter @scorel/core test -- reporting
pnpm --filter @scorel/app-cli test -- index
pnpm --filter @scorel/app-cli typecheck
```

Before completion, run:

```bash
pnpm typecheck && pnpm test
```

## Affected Paths

- `packages/core/src/reporting/`
- `packages/core/src/index.ts`
- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`
- `docs/ROADMAP.md`
- `docs/spec/ship/S0110-scorel-eval-reporting-compatibility.md`

## Risks

- Harbor result expectations can change. Mitigation: make Scorel's native files stable and keep Harbor-specific mapping thin.
- Static prices drift. Mitigation: expose `pricingSource` and unknown status, and keep price updates isolated to the table.
- Event arrays can grow large. S0110 keeps current `scorel run` full-event summary behavior, while S0111 should define broader observability and retention policy.
