# S0001: Docs Baseline

## Goal

Create the first implementation-ready documentation baseline for rebuilding Scorel from scratch.

## Scope

- Keep `docs/architecture.md` aligned with the final package boundary: `protocol / core / daemon / client / apps`.
- Keep abstract module specs in top-level `docs/spec/*.md`.
- Ensure the first baseline commit records the formal documentation baseline and excludes old implementation code.
- Exclude old implementation code from the baseline.

## Not In Scope

- No runtime implementation.
- No package scaffolding.
- No release automation.
- No `IMPLEMENTATION_PROMPT.md` cleanup.

## Acceptance Criteria

- [x] `docs/architecture.md` describes final package structure and data flow.
- [x] Top-level `docs/spec/*.md` covers events, session, runtime, daemon, client, tools, extensions, channels.
- [x] Outdated single-package final architecture is not presented as the current target.
- [x] First docs baseline commit records formal docs and root project metadata only.

## Test Requirements

- Documentation review only.
- Run `rg "单包|不拆多包|import type from \"@scorel/core\"" docs/architecture.md docs/spec/*.md` and confirm no current-target contradiction remains.

## Affected Paths

- `docs/architecture.md`
- `docs/spec/*.md`
- `docs/spec/ship/*.md`

## Risks

- If temporary prompt docs are included in the first commit, they may freeze immature planning as source of truth.
