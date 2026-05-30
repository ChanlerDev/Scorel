# S0039: WebUI End-to-End Validation And New Chat

## Goal

Add `New Chat` (creates a new session under the currently selected project) and run a full real-daemon, real-LLM end-to-end pass. This spec is the gate for marking M5 WebUI Done.

## Scope

- `New Chat` action in sidebar:
  - Visible only when a project is selected (`/devices/:deviceId/projects/:projectSlug` or descendants).
  - Click flow:
    1. Call `client.createSession({ meta: { projectSlug, model: <default-from-daemon-config>, title: "New chat" } })`.
    2. Daemon returns `{ sessionId }`.
    3. Optimistically prepend the new session to `DeviceProject.sessions`.
    4. Navigate to `/devices/:deviceId/projects/:projectSlug/sessions/:sessionId`.
  - Failure: surface inline toast/banner; do not navigate.
- Session-creation server side already exists (`create_session` in protocol/daemon). v1 does not introduce cwd input; the daemon decides cwd by its own startup. Document this.
- End-to-end validation matrix (manual, gated on real LLM provider):
  1. Fresh state: clear `~/.scorel/`, clear browser localStorage.
  2. Start daemon: `scorel daemon serve --remote --token TOKEN --port PORT --cwd /path/to/repo`.
  3. WebUI: open root, navigate to `/settings`, add Device with the daemon's link/token. Verify sidebar dot turns green.
  4. Verify Device → Project tree shows the cwd's project; `displayName` is `basename(cwd)`.
  5. Click `New Chat`. Verify navigation to a new session route and an empty chatbox.
  6. Send "list files" prompt. Verify streaming text + tool call(s) + tool result(s) render correctly.
  7. Click Cancel mid-tool-loop on a longer prompt; verify cancel acknowledged.
  8. Open `scorel attach --remote ws://… --session <id>` in another terminal; verify both clients show identical transcript.
  9. Send prompt from CLI; verify WebUI updates live.
  10. Reload WebUI tab; chatbox restored from cache, then resyncs.
  11. Stop daemon; sidebar shows offline state. Restart daemon; click Reconnect; sidebar returns to green.
  12. Refresh `~/.scorel/sessions/`: confirm a JSONL file exists with the right `projectSlug` in header.
- WebUI README in `apps/webui/README.md` documenting the dev workflow:
  - install / dev / build commands
  - how to point WebUI at a real daemon
  - known limitations (token cleartext in localStorage; manual reconnect on errors; no Skills/Plugins/Automations v1)

## Not In Scope

- Optional Playwright wiring is welcome but not required; if added, it is supplementary to the manual matrix.
- Custom `cwd` input on `New Chat`.
- Project search, session search.
- Branch / fork / compact UX.

## Acceptance Criteria

- `New Chat` button creates a session via daemon and navigates to it; failure shows banner without navigating.
- Manual end-to-end validation matrix above passes on a real daemon + real LLM provider on the engineer's local machine; results recorded in `self/discussions/2026-05-30-webui-rebuild-brainstorm.md` append section.
- README in `apps/webui` describes the user-visible dev workflow accurately.
- `pnpm --filter @scorel/webui typecheck && pnpm --filter @scorel/webui test` passes.
- Repo `pnpm typecheck && pnpm test` passes.
- `docs/ROADMAP.md` M5 status updated to **Done** in this spec's commit chain (only the final spec flips status).

## Tests

- Unit test for `New Chat` action: stubs `createSession`, asserts optimistic prepend + navigation.
- Failure path test: error response keeps cache untouched and surfaces banner.
- Manual: full matrix as above.

## Affected Paths

- `apps/webui/lib/sync/session-create.ts` (new)
- `apps/webui/lib/sync/session-create.test.ts` (new)
- `apps/webui/components/shell/new-chat-button.tsx` (new)
- `apps/webui/components/shell/sidebar.tsx` (mount New Chat in proper slot)
- `apps/webui/README.md` (new)
- `docs/ROADMAP.md` (M5 status → Done)
- `docs/spec/client.md` (note `createSession` is part of WebUI flow now)
- `self/discussions/2026-05-30-webui-rebuild-brainstorm.md` (append validation results)

## Risks And Boundaries

- **`New Chat` cwd**: v1 ties new sessions to daemon cwd. If a user wants different cwd, they must run a separate daemon. Document clearly.
- **Default model**: pulled from daemon config. WebUI does not let the user pick model v1; raise as a follow-up.
- **Manual matrix repeatability**: relies on the engineer's environment; record exact commands and observed behavior in the discussion log so the next pass is reproducible.
- **Marking M5 Done**: once this spec ships, ROADMAP M5 status flips to Done; any further WebUI feature work uses new milestone or post-M5 specs.
