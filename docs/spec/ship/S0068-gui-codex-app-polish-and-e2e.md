# S0068: GUI Codex App Polish And E2E

## Goal

Bring the first GUI milestone to a credible Codex App-style desktop experience and verify both local and Relay Project paths end to end with real product resources.

## Scope

- Polish the GUI visual system and interaction model against Codex App expectations:
  - quiet workbench layout
  - dense but readable Project / Session navigation
  - restrained controls
  - clear connection and running states
  - no marketing-style landing page
- Align reusable styling with `docs/design.md` where it still applies.
- Add explicit empty, loading, offline, disconnected, and error states.
- Validate local Project path end to end.
- Validate Relay Project path end to end.
- Document verification evidence.
- Mark M9 Done when all prior M9 specs are complete and verified.

## Non-Goals

- Do not add SSH Remote Device.
- Do not add HTTP API.
- Do not add plugin / automation / file explorer / diff viewer unless already required by a prior M9 spec.
- Do not ship production desktop installers unless a dedicated release spec is created.

## Acceptance Criteria

- GUI feels like a desktop workbench, not a browser page wrapped in a window.
- Local Project: add/select Project, create Session, send prompt, see persisted response.
- Relay Project: add Relay Device, select remote Project, create/open Session, send prompt, see persisted response.
- Offline Relay Device and disconnected Host states are visible and recoverable without app crash.
- Text fits in project/session rows and composer controls across expected desktop window sizes.
- M9 ROADMAP status can be moved to Done only after this spec and earlier M9 specs pass verification.

## Test Requirements

Run:

```bash
pnpm --filter @scorel/app-gui typecheck
pnpm typecheck
pnpm test
git diff --check
```

Manual e2e must use:

- real GUI app
- real embedded local Host
- real Relay path
- real JSONL sessions
- real provider

If browser or screenshot tooling is used for renderer verification, record viewport/window sizes and include screenshots or notes in the verification artifact.

## Affected Paths

- `apps/gui/**`
- `docs/design.md` only if GUI-specific design rules need to be added
- `docs/ROADMAP.md`
- `docs/spec/ship/S0068-gui-codex-app-polish-and-e2e.md`
- optional verification artifact under `docs/spec/ship/`

## Risks

- Codex App parity can become an unbounded visual target. S0068 should polish the first M9 workflow, not invent every Codex feature.
- E2E can pass locally while desktop packaging is still unsolved. Packaging is separate unless explicitly added.
- UI reuse from WebUI can carry browser-specific assumptions. GUI should reuse implementation only when it supports the desktop product model.
