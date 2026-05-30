# S0030: WebUI Baseline

## Goal

Create the first M5 WebUI-only product slice: a browser-safe WebUI app shell that can collect a remote daemon WebSocket endpoint, token, and session id, then connect through the existing `@scorel/client` `WsTransport` and `DaemonClient` path.

S0030 proves that M5 starts as a thin Web client over the M4 remote transport. It does not introduce GUI, a second client SDK, or a WebUI-specific daemon protocol.

## Scope

- Add `apps/webui` as a workspace app.
- Keep WebUI browser-safe:
  - depends only on `@scorel/client` and `@scorel/protocol` among Scorel packages
  - does not depend on `@scorel/core`, `@scorel/daemon`, or Node-only APIs in source files
- Add a minimal app shell with:
  - remote WebSocket endpoint input
  - token input
  - session id input
  - connect action
  - connection status and daemon identity display
- Add a small WebUI connection module that constructs:
  - `new WsTransport({ url, token })`
  - `new DaemonClient(transport, { clientId })`
  - `client.connect(sessionId)`
- Reuse the existing browser-safe client root export.
- Add a minimal browser bundle command for the WebUI entrypoint.
- Update `docs/ROADMAP.md` so M5 is explicitly WebUI-only and records S0030 as the first step.

## Not In Scope

- GUI, Tauri, Electron, native menus, local daemon process management, or packaged desktop distribution.
- Session list, project browser, or session tree UI.
- Event stream rendering beyond a connection-ready placeholder.
- Prompt sending, cancel, permission UI, sandbox UI, checkpoint UI, or rewind/fork controls.
- OAuth, account system, automatic TLS, tunnel, relay, or token provisioning.
- A new WebUI-specific transport, daemon request type, or test-only protocol path.

## Acceptance Criteria

- `apps/webui` is part of the pnpm workspace and has `typecheck` and `test` scripts.
- `apps/webui` has a `build` script that emits the browser entrypoint consumed by `index.html`.
- WebUI source imports the root `@scorel/client` and `@scorel/protocol` browser-safe entrypoints.
- WebUI can create a `DaemonClient` backed by `WsTransport` from endpoint/token/session id values.
- A unit test proves the WebUI connector sends the existing WebSocket `connect` message with token and session identity.
- A package boundary test proves WebUI does not depend on `@scorel/core` or `@scorel/daemon`.
- A browser-safety test proves WebUI source files do not import Node built-ins.
- `pnpm --filter @scorel/app-webui test` passes.
- `pnpm --filter @scorel/app-webui typecheck` passes.
- `pnpm --filter @scorel/app-webui build` passes.
- `pnpm typecheck && pnpm test` passes.

## Tests

- Add WebUI connector tests using an injected browser-like WebSocket.
- Add WebUI package boundary tests.
- Add WebUI browser-safety tests.
- Run WebUI build.
- Run targeted WebUI tests and typecheck.
- Run full repo verification.

## Affected Paths

- `docs/ROADMAP.md`
- `docs/spec/ship/S0030-webui-baseline.md`
- `apps/webui/package.json`
- `apps/webui/tsconfig.json`
- `apps/webui/src/`

## Risks And Boundaries

- The WebUI baseline can drift into a second client implementation. Keep all daemon interaction behind `DaemonClient` and `WsTransport`.
- Browser bundling can accidentally pull Node-only code into the app. Keep WebUI dependencies limited to browser-safe root exports and enforce this with tests.
- A visually rich UI is premature in S0030. The value here is a real browser-compatible control surface baseline that later S specs can grow into session browsing, event rendering, prompt control, and real remote smoke.
