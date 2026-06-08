# S0065: GUI Electron Shell And Embedded Host

## Goal

Create the first `apps/gui` Electron app shell and connect it to the local embedded Scorel Host. After this spec, opening the GUI should prove that desktop main process, renderer, and local Host lifecycle can cooperate without duplicating Runtime or Session ownership.

## Scope

- Add `apps/gui` workspace package.
- Add Electron main process and renderer entry.
- Add a small GUI bridge between renderer and main process.
- Start or attach to an embedded local Host from the GUI main process.
- Expose local Host connection state to the renderer.
- List local Host Registry Projects through Host / client APIs.
- Keep UI minimal: enough shell to show local connection and Project list placeholder.
- Keep GUI distribution separate from `@chanlerdev/scorel` npm CLI package.

## Non-Goals

- Do not implement full chat UX.
- Do not implement Relay Device settings.
- Do not implement remote Project selection.
- Do not package signed desktop installers.
- Do not implement auto-start, tray behavior, or auto-update.
- Do not add SSH or direct WS connector support.

## Acceptance Criteria

- `apps/gui` exists and is included in the workspace.
- GUI can be launched in development from a root script or package script.
- Electron main owns embedded local Host startup / connection.
- Renderer can display local Host status and local Project list from the embedded Host.
- Renderer does not import `@scorel/core` or directly write session JSONL.
- Existing CLI release package does not include GUI files unless a later spec explicitly changes desktop distribution.

## Test Requirements

Run focused checks for the GUI package plus existing repo checks:

```bash
pnpm --filter @scorel/app-gui typecheck
pnpm typecheck
pnpm test
git diff --check
```

If a GUI smoke command exists after implementation, run it and document the exact command in the implementation notes.

## Affected Paths

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `apps/gui/**`
- `packages/client/**` if bridge/client APIs need small reuse adjustments
- `docs/ROADMAP.md`
- `docs/spec/ship/S0065-gui-electron-shell-and-embedded-host.md`

## Risks

- Electron dependency churn can bloat the monorepo. Keep GUI dependencies scoped to `apps/gui`.
- Renderer/main boundaries can become leaky. Treat renderer as an Entry UI and keep Host ownership in main.
- Embedded Host lifecycle may diverge from CLI `scorel` behavior. Reuse existing Host APIs where possible instead of creating GUI-only behavior.
