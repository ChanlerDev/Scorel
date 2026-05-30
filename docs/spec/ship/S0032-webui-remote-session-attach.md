# S0032: WebUI Remote Session Attach

## Goal

Make the WebUI shell actually attach to a remote daemon session and maintain explicit connection state for reconnect/resync.

S0032 turns the S0031 connection panel from static scaffolding into a browser client control path over the existing `@scorel/client` `DaemonClient + WsTransport` path. It still does not render the event stream or send prompts; those remain S0033 and S0035.

## Scope

- Add a WebUI remote session controller that:
  - accepts endpoint, token, and session id
  - calls `connectToRemoteSession`
  - calls `client.resync()` after connect
  - records connection status, daemon identity, session id, anchors, and resync mode
  - supports a manual reconnect action using the last connection input
  - surfaces concise connection errors without logging or persisting the token
- Wire the controller into the WebUI DOM:
  - connect form updates visible connection status
  - connected state displays daemon identity (`deviceDisplayName`, `deviceId`, `projectSlug`)
  - resync mode and seq anchors are visible for diagnostics
  - reconnect button retries the last connection
- Keep all WebUI daemon interaction behind `DaemonClient` and `WsTransport`.

## Not In Scope

- Automatic reconnect loops or backoff.
- Local storage/session storage persistence of endpoint, token, session id, anchors, or cache.
- Event stream rendering from `DaemonClient.subscribe()`.
- Project/session browser from project index or daemon list.
- Prompt sending, cancel, model switching, or tool execution.
- GUI or local daemon process management.

## Acceptance Criteria

- WebUI connection state starts as disconnected.
- Successful connect records `connected` status, session id, daemon identity, dual-seq anchors, and resync mode.
- Failed connect records `error` status and a concise error message without exposing the token.
- Reconnect reuses the last connection input and calls the same `connectToRemoteSession` path.
- WebUI DOM has explicit status, identity, resync, anchor, and reconnect regions.
- Existing S0030 connection wiring and S0031 shell tests still pass.
- Browser-safety and package-boundary tests still pass.
- `pnpm --filter @scorel/app-webui build` passes.
- `pnpm --filter @scorel/app-webui typecheck` passes.
- `pnpm --filter @scorel/app-webui test` passes.
- `pnpm typecheck && pnpm test` passes.

## Tests

- Add controller tests for:
  - initial disconnected state
  - successful connect and resync state projection
  - token-redacted failure state
  - manual reconnect using the last input
- Add/update shell tests for connection status, identity, resync, anchors, and reconnect regions.
- Run WebUI build/typecheck/test.
- Run full repo verification.
- Run local browser smoke for the visible connection regions.

## Affected Paths

- `docs/ROADMAP.md`
- `docs/spec/ship/S0032-webui-remote-session-attach.md`
- `apps/webui/src/app.ts`
- `apps/webui/src/shell.ts`
- `apps/webui/src/app.test.ts`
- `apps/webui/src/remote-session.ts`
- `apps/webui/src/remote-session.test.ts`

## Risks And Boundaries

- Reconnect can be overbuilt into a background supervisor. S0032 only adds explicit manual reconnect and resync state.
- Tokens must stay in memory and never appear in status/error text.
- URL remains a connection locator. Stable remote identity comes from daemon-reported `deviceId + projectSlug`, with `deviceDisplayName` as display-only metadata.
