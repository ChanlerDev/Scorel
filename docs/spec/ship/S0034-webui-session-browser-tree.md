# S0034: WebUI Session Browser And Tree

## Goal

Let WebUI users choose sessions from the daemon and inspect a first session tree projection.

S0034 completes the M5 session navigation slice by implementing the real daemon/client `list_sessions` path, wiring it into the WebUI sidebar, and deriving a read-only tree from persistent events returned by `loadSession()`.

## Scope

- Implement daemon `list_sessions` for loaded daemon sessions.
- Add `DaemonClient.listSessions()`.
- Add a WebUI session browser module that:
  - calls `client.listSessions()`
  - calls `client.loadSession(sessionId)` for the selected session
  - projects persistent events into a shallow tree/list with `id`, `parentId`, role/type, text, and active leaf marker
- Wire WebUI after remote attach:
  - refresh session list through the connected client
  - render sessions in the sidebar
  - render first tree projection in the central stream area beside the event stream scaffold
- Keep project grouping simple for S0034:
  - one remote project from daemon identity (`projectSlug`)
  - no browser filesystem access to `project-index.json`

## Not In Scope

- Reading local `~/.scorel/project-index.json` from browser.
- Persisting browser-side project/session cache.
- Rewind/fork/compact controls.
- Editing tree nodes or changing active leaf.
- Full multi-project synchronization across remote daemons.
- GUI/local daemon process management.

## Acceptance Criteria

- Daemon `list_sessions` returns summaries for loaded sessions instead of `invalid_request`.
- `DaemonClient.listSessions()` sends the existing protocol request and returns summaries.
- WebUI can refresh session summaries after connecting.
- WebUI can load a selected session and render persistent events as a read-only session tree projection.
- Tree projection marks the active leaf returned by `loadSession()`.
- Existing event stream rendering remains intact.
- `pnpm --filter @scorel/app-webui build` passes.
- `pnpm --filter @scorel/app-webui typecheck` passes.
- `pnpm --filter @scorel/app-webui test` passes.
- `pnpm typecheck && pnpm test` passes.

## Tests

- Add daemon protocol test for `list_sessions`.
- Add client test for `DaemonClient.listSessions()`.
- Add WebUI session browser/tree projection tests.
- Add shell/app tests for sidebar session list and tree region.
- Run targeted package tests.
- Run full repo verification.
- Run local browser smoke for session browser/tree placeholders.

## Affected Paths

- `docs/ROADMAP.md`
- `docs/spec/ship/S0034-webui-session-browser-tree.md`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/protocol.test.ts`
- `packages/client/src/index.ts`
- `packages/client/src/daemon-client.test.ts`
- `apps/webui/src/session-browser.ts`
- `apps/webui/src/session-browser.test.ts`
- `apps/webui/src/remote-session.ts`
- `apps/webui/src/shell.ts`
- `apps/webui/src/app.ts`
- `apps/webui/src/app.test.ts`

## Risks And Boundaries

- `list_sessions` is a daemon view of sessions it knows about; it is not a browser-side project index reader.
- The tree projection is UI-only and must not become scheduling or context-building logic.
- Avoid turning S0034 into full project management. Real project grouping beyond daemon identity can be added later.
