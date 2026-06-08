# S0064: GUI Product Intent And Boundary

## Goal

Lock M9 GUI as a Project-first desktop app before implementation. The GUI should feel and behave like a Codex App-style workbench: local-first, project-centric, quiet, dense, and built for repeated engineering work.

## Scope

- Define GUI as an independent desktop app under `apps/gui`.
- Use Electron for the first GUI implementation because the current Scorel runtime, Host, CLI, Relay client, and package graph are TypeScript / Node-first.
- Keep the public `@chanlerdev/scorel` npm package focused on the CLI / Host / Relay operator surface; GUI distribution is separate.
- Define GUI information architecture:
  - Project-first main workspace.
  - Settings manages Devices and connectors.
  - Device identity is metadata and connection source, not the main navigation root.
- Define local behavior:
  - GUI main process uses embedded local Host.
  - Local Host Registry projects are all visible in the GUI project list.
- Define remote behavior:
  - M9 remote scope is Relay-only.
  - Settings can add Relay Devices.
  - Remote Projects appear only after the user explicitly selects them in GUI.
  - GUI must not auto-display the full remote Host Registry the way WebUI does.
- Define design direction:
  - Codex App is the primary product reference.
  - Existing WebUI components and style rules may be reused where they match the GUI product model.

## Non-Goals

- Do not scaffold Electron in S0064.
- Do not implement GUI screens.
- Do not add SSH, direct WS + token, OAuth, account systems, or GUI auto-update.
- Do not publish or package desktop installers.
- Do not change the public npm CLI package surface.

## Contract

### Product Model

WebUI and GUI intentionally differ:

- WebUI is Device-first. After a Device is connected, WebUI shows the Device Host Registry's full Project list.
- GUI is Project-first. Local Projects are shown in full, but remote Projects are curated by explicit user selection.

### Desktop Boundary

Electron main process may depend on Node-only Scorel packages and own local Host lifecycle. Electron renderer must remain an Entry UI: it may call GUI bridge APIs or `@scorel/client`, but it must not hold Runtime, write JSONL, or duplicate Host domain logic.

### Remote Boundary

M9 remote work uses Relay only. SSH Remote Device remains M10. Direct WS + token remains an advanced/non-M9 path.

## Acceptance Criteria

- `docs/ROADMAP.md` splits M9 into executable S specs.
- `docs/spec/ship/S0064-gui-product-intent-and-boundary.md` records the GUI product boundary.
- The spec clearly states Electron is a GUI app distribution choice, not a change to the public npm CLI package.
- The spec clearly states remote Project visibility differs from WebUI.
- The spec clearly states M9 remote scope is Relay-only.

## Test Requirements

Docs-only:

```bash
git diff --check
```

## Affected Paths

- `docs/ROADMAP.md`
- `docs/spec/ship/S0064-gui-product-intent-and-boundary.md`
- `self/discussions/2026-06-08-repo-sync-and-m9-next-step.md`

## Risks

- Electron may inflate install size. This is acceptable for GUI distribution but must not leak into the CLI npm package.
- Reusing WebUI too directly can accidentally preserve Device-first information architecture. S0064 locks Project-first as the GUI product rule.
- Showing all remote Projects would expose too much remote workspace state and weaken the desktop curation model.
