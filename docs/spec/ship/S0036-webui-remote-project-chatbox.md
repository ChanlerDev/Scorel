# S0036: WebUI Remote Projects And Chatbox

## Goal

Replace the temporary M5 WebUI shell with a real remote-first chatbox interface organized by `Remote -> Project -> Session`.

S0036 fixes the M5 product shape. WebUI cannot embed or manage a local daemon, so it must persist remote connection profiles in browser storage, connect to a selected remote, synchronize project/session indexes from the daemon, and present the active session as a focused chatbox rather than a dashboard-like scaffold.

## Scope

- Add browser-local remote profile storage:
  - profile id, display name, endpoint, token, last selected project/session, updated time
  - persist in `localStorage`
  - no JSONL, attach cache, or filesystem paths in WebUI storage
- Add a WebUI sync model:
  - connect to a selected remote profile
  - derive remote identity from daemon handshake (`deviceId`, `deviceDisplayName`, `projectSlug`)
  - synchronize projects first
  - synchronize sessions under each project
  - keep session contents lazy: load/sync a session only when selected
  - maintain per-session anchors in `localStorage`: `persistentLastSeq` and `streamLastSeq`
- Keep the protocol shape project-aware:
  - S0036 may map the current daemon to one remote project from `projectSlug`
  - expose the WebUI state as a projects array so future multi-project daemon support does not require another UI rewrite
- Redesign the UI as a chatbox:
  - left rail: saved remotes and remote settings entry
  - project/session sidebar: selected remote's projects, then sessions under the selected project
  - main area: chat transcript, clear empty state, bottom composer
  - remote config panel: endpoint/token/display name, save/connect
  - remove fake project rows and dashboard-style diagnostic clutter from the primary surface
- Keep advanced sync details available as subtle status text, not primary navigation.

## Not In Scope

- Multi-project daemon backend beyond current `projectSlug` identity.
- Browser-side JSONL or attach cache persistence.
- OAuth, account auth, TLS provisioning, relay, or NAT traversal.
- GUI / Tauri / Electron.
- Full session content prefetch for every session.
- Rewind/fork/compact UI.
- File explorer/editor or IDE layout.

## Acceptance Criteria

- WebUI persists remote profiles in `localStorage`.
- Saved remotes survive app remount.
- Connecting a remote first synchronizes projects, then sessions.
- Sessions are grouped under projects, not shown as global fake rows.
- Selecting a session loads persistent events lazily and updates local anchors.
- Composer sends prompts to the selected session.
- Cancel calls the selected session's real cancel path.
- Main UI reads visually as a focused chatbox.
- No hard-coded fake projects/sessions remain in the shell.
- `pnpm --filter @scorel/app-webui build` passes.
- `pnpm --filter @scorel/app-webui typecheck` passes.
- `pnpm --filter @scorel/app-webui test` passes.
- `pnpm typecheck && pnpm test` passes.
- Browser smoke verifies remote settings persistence and the chatbox layout.

## Tests

- Add localStorage store tests for remote profiles and session anchors.
- Add sync model tests proving remote identity creates a project and sessions belong under it.
- Add controller tests for connect -> project sync -> session sync -> lazy load.
- Add shell/app tests proving:
  - no fake project/session rows
  - remote settings panel exists
  - project/session sidebar is grouped
  - main area is chatbox-oriented
- Run targeted WebUI build/typecheck/test.
- Run full repo verification.
- Run browser smoke.

## Affected Paths

- `docs/ROADMAP.md`
- `docs/spec/ship/S0036-webui-remote-project-chatbox.md`
- `apps/webui/src/remote-store.ts`
- `apps/webui/src/remote-store.test.ts`
- `apps/webui/src/remote-sync.ts`
- `apps/webui/src/remote-sync.test.ts`
- `apps/webui/src/remote-session.ts`
- `apps/webui/src/remote-session.test.ts`
- `apps/webui/src/session-browser.ts`
- `apps/webui/src/session-browser.test.ts`
- `apps/webui/src/shell.ts`
- `apps/webui/src/app.ts`
- `apps/webui/src/app.test.ts`

## Risks And Boundaries

- Browser storage is convenience state, not authoritative session history.
- Tokens in localStorage are a local browser trust decision. S0036 stores them because the user explicitly configures remotes in WebUI; it must avoid logging or rendering tokens back into visible diagnostic text.
- Current daemon exposes one served project via `projectSlug`. The UI must still model projects as a list to avoid repainting the product architecture later.
