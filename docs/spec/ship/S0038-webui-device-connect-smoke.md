# S0038: WebUI Device Connect Smoke

## Goal

Make the WebUI Settings -> Device connect path work in a real browser against a real remote daemon, and make common connection failures understandable.

S0037 fixed the UI hierarchy, but the real user path can still fail too easily: the Link field expects a raw WebSocket URL, the previous trial command could start no daemon if config is missing, and a failed connection does not give enough product-level guidance. S0038 makes Device connect the primary acceptance path.

## Scope

- Normalize Device Link before opening WebSocket:
  - `127.0.0.1:18789` -> `ws://127.0.0.1:18789`
  - `localhost:18789` -> `ws://localhost:18789`
  - `http://host` -> `ws://host`
  - `https://host` -> `wss://host`
  - preserve existing `ws://` / `wss://`
- Reject empty or non-WebSocket links with a readable error.
- Keep failed connections on Settings and render the error in `data-status`.
- Keep successful no-session connections visibly useful by rendering Device -> Project -> "No sessions synced".
- Verify a real daemon connection from the WebUI build in a browser.

## Not In Scope

- Creating sessions from WebUI.
- Editing/deleting devices.
- Account auth, relay, TLS provisioning, or NAT traversal.
- Backend multi-project enumeration beyond current daemon `projectSlug`.

## Acceptance Criteria

- User can paste `127.0.0.1:<port>` into Link and WebUI connects through `ws://127.0.0.1:<port>`.
- User can paste `http://127.0.0.1:<port>` and WebUI connects through `ws://127.0.0.1:<port>`.
- Invalid Link produces a visible error and does not navigate away from Settings.
- A successful connection renders a Device root, a Project child, and a session empty state if no sessions exist.
- `pnpm --filter @scorel/app-webui build` passes.
- `pnpm --filter @scorel/app-webui typecheck` passes.
- `pnpm --filter @scorel/app-webui test` passes.
- `pnpm typecheck && pnpm test` passes.
- Browser smoke connects to a real local remote daemon.

## Tests

- Add connection tests for Device Link normalization and validation.
- Add app/shell tests for error visibility and no-session connected tree state where practical.
- Run targeted WebUI checks.
- Run full repo checks.
- Run browser smoke against a real daemon.

## Affected Paths

- `docs/ROADMAP.md`
- `docs/spec/ship/S0038-webui-device-connect-smoke.md`
- `apps/webui/src/connection.ts`
- `apps/webui/src/connection.test.ts`
- `apps/webui/src/app.ts`
- `apps/webui/src/app.test.ts`

## Risks And Boundaries

- Link normalization is convenience behavior, not discovery. Users still need a reachable daemon host/port and the correct token.
- Browser storage remains local convenience state; daemon/session history remains authoritative remotely.
