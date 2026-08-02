# S0118: Reasoning Effort Eval Path

## Goal

Make reasoning effort a first-class, reproducible Scorel run parameter across
CLI, GUI, session persistence, provider execution, local reports, and the
Harbor / Terminal-Bench adapter.

## Scope

- Define one shared reasoning-effort contract:
  - `minimal`
  - `low`
  - `medium`
  - `high`
  - `xhigh`
- Extend model selection so an optional effort is persisted in the resolved
  session model summary and restored with the session. Later model/effort
  changes are persisted as append-only `session_model_selected` events.
- Pass the selected effort through runtime creation to pi-ai's existing
  `streamSimple` reasoning option.
- Rebuild a chat runtime when effort changes even if the model id is unchanged.
- Add `scorel run --reasoning-effort <value>` with strict validation.
- Include effort in Scorel run summary, metadata, and trajectory reports.
- Add a GUI Reasoning Effort selector next to the model selector. Enable it
  only when the selected model advertises reasoning support.
- Add a public-safe Harbor installed-agent adapter that accepts
  `--ak reasoning_effort=<value>`, forwards the CLI flag, and records effort in
  Harbor metadata and ATIF agent steps.
- Keep all provider connection settings runtime-only in the public adapter.

## Not In Scope

- Choosing a non-default effort automatically.
- Adding reasoning effort to persistent device config or model profiles.
- Translating provider-specific effort names beyond pi-ai's existing mapping.
- Modifying Terminal-Bench datasets or uploading leaderboard submissions.
- Publishing private provider endpoints, credentials, local eval jobs, or
  historical benchmark outputs.

## Acceptance Criteria

- `scorel run --reasoning-effort high` reaches the provider payload.
- Invalid effort values fail as CLI usage errors.
- New session JSONL headers persist the selected effort with `selectedModel`.
- Later model/effort changes persist without replacing the immutable header.
- Restored sessions recreate the runtime with the persisted effort.
- A same-model effort change recreates the chat runtime.
- Run summary, `scorel-metadata.json`, and `scorel-trajectory.json` identify the
  requested effort.
- GUI shows Default plus all five effort values next to model selection.
- GUI disables effort selection for models without reasoning capability and
  does not send stale effort after switching to such a model.
- Harbor accepts `--ak reasoning_effort=...`, forwards it to `scorel run`, and
  records it in metadata / ATIF.
- Tracked eval files contain no real provider endpoint, provider identity,
  credential, token, local job output, or `.env` file.

## Testing Requirements

- CLI integration test covers payload forwarding, session persistence,
  reports, and existing API-key redaction.
- Daemon test covers persistence and same-model effort runtime rebuild.
- GUI tests cover capability gating and model-selection normalization.
- Harbor adapter tests cover allowed/invalid effort and runtime-only provider
  agent kwargs.
- Full `pnpm typecheck && pnpm test`.

## Impacted Files

- `packages/protocol/src/events.ts`
- `packages/core/src/reporting/index.ts`
- `packages/daemon/src/index.ts`
- `apps/cli/src/index.ts`
- `apps/cli/src/daemon-cli.ts`
- `apps/gui/src/**`
- `eval/**`
- related docs and tests

## Risks And Boundaries

- Provider support differs by model and API. Scorel only sends an explicit
  effort; pi-ai remains responsible for provider-specific mapping.
- Effort is distinct from the model's `reasoning` capability flag. GUI gates
  the control using capability metadata, while headless provider overrides mark
  the run-local model reasoning-capable when an effort is explicitly supplied.
- Omitted effort remains `undefined`; Scorel must not silently choose a level
  and pi-ai retains responsibility for its existing default behavior.
- Eval connection details stay in runtime agent kwargs and must never enter
  source, reports, diagnostics, or committed fixtures. Harbor job files must be
  scrubbed before upload because Harbor persists agent kwargs in local config.
