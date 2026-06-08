# S0066: GUI Local Project Workspace

## Goal

Make the GUI useful for local work: show all local Projects in a Project-first workspace, let the user create or open Sessions, and provide the first local chat surface over the embedded Host.

## Scope

- Build the Project-first main GUI layout:
  - Project list as the primary navigation.
  - Session list scoped to the selected Project.
  - Chat / composer surface for the selected Session.
- Show all Projects from the local Host Registry.
- Add local Project through a desktop folder picker and `registerProject(workDir)`.
- Create a new Session for a selected local Project.
- Load existing Sessions via `listSessions({ projectId })`.
- Send prompts through the same Host / DaemonClient path used by other entries.
- Reuse WebUI rendering pieces only where they fit Codex App-style desktop UX.

## Non-Goals

- Do not add Relay Device settings.
- Do not add remote Project selection.
- Do not implement SSH or direct WS.
- Do not implement advanced Codex App features such as diffs, file tree, approval UI, terminal panes, or task tabs.
- Do not add model picker functionality unless it already exists as a shared product path.

## Acceptance Criteria

- GUI starts with local Projects visible without requiring Device selection.
- Selecting a local Project shows its Sessions.
- New Session creates a Session bound to the selected `projectId`.
- Sending a prompt uses the embedded local Host and writes a real JSONL Session.
- Local Project addition uses the system folder picker and Host `registerProject`.
- Local Project list updates after registration.
- UI is Project-first; Device is not the main navigation hierarchy.

## Test Requirements

Run:

```bash
pnpm --filter @scorel/app-gui typecheck
pnpm typecheck
pnpm test
git diff --check
```

Manual smoke must use:

- real local temporary Project directory
- embedded local Host
- real JSONL Session
- real provider for at least one prompt if this spec wires chat sending end to end

## Affected Paths

- `apps/gui/**`
- `packages/client/**` if shared session projection needs extraction
- `packages/daemon/**` only for reusable embedded Host API gaps
- `docs/ROADMAP.md`
- `docs/spec/ship/S0066-gui-local-project-workspace.md`

## Risks

- Over-copying WebUI can recreate Device-first navigation. Keep Project as the first-level object.
- Local folder picker can tempt renderer-side filesystem access. Use main process bridge and Host APIs; renderer should not become the owner of Project canonicalization.
- Chat surface scope can grow. Keep S0066 focused on local session creation, display, and prompt sending.
