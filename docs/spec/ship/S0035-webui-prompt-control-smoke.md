# S0035: WebUI Prompt Control And Real Smoke

## Goal

Let WebUI users send prompts and cancel an in-flight turn through the same remote daemon protocol used by CLI attach, then close M5 with a real WebUI smoke.

S0035 finishes the WebUI control slice: prompt send, cancel, shared event stream updates, and real remote daemon validation. The cancel button must call a real daemon/client protocol path; it must not be a disabled placeholder or browser-only state change.

## Scope

- Add a protocol `cancel` request for the current session:
  - client sends `{ type: "cancel", requestId, sessionId }`
  - daemon calls the session runtime `cancel()`
  - daemon responds with `{ sessionId, cancelled }`
- Add `DaemonClient.cancel()` using the connected session id.
- Wire WebUI composer:
  - prompt textarea submits through `sendMessage()`
  - Send is disabled without a connected session or blank input
  - Cancel calls `cancel()` while preserving the shared event stream
  - composer status reports sending/cancel outcomes without leaking tokens
- Keep event stream rendering and session browser projection intact after sends and cancels.
- Update daemon/client protocol docs for the implemented cancel shape.
- Run a real local browser smoke against the built WebUI.
- Run a real remote daemon smoke with WebUI talking over `WsTransport` to an actual daemon endpoint and a real JSONL session.

## Not In Scope

- Steering/follow-up queues.
- Rewind/fork/compact controls.
- Permission approval UI or sandbox controls.
- GUI / Tauri / Electron.
- Rich composer attachments, file upload, model switching, or tool picker behavior.
- Public relay, TLS automation, account auth, or OAuth.

## Acceptance Criteria

- Protocol types include `cancel`.
- Daemon cancel responds immediately and calls `ScorelRuntime.cancel()` for the target loaded session.
- Runtime cancellation produces normal session events (`turn_end` with `cancelled`, and a partial assistant message when text exists) through the existing event stream.
- `DaemonClient.cancel()` sends the protocol request and returns whether a running turn was cancelled.
- WebUI composer sends non-empty prompts via `sendMessage()`.
- WebUI cancel button calls `DaemonClient.cancel()` through the remote controller.
- CLI attach and WebUI still share daemon session events through the same session id and remote WebSocket transport.
- `pnpm --filter @scorel/app-webui build` passes.
- `pnpm --filter @scorel/app-webui typecheck` passes.
- `pnpm --filter @scorel/app-webui test` passes.
- `pnpm typecheck && pnpm test` passes.
- Real WebUI smoke opens the built app in a browser and verifies the composer/session surfaces.
- Real remote smoke uses a daemon WebSocket endpoint, real token, real JSONL session, and real provider path; no fake/mock provider is used as completion proof.

## Tests

- Add protocol type tests for `cancel`.
- Add daemon protocol test for cancelling an in-flight turn.
- Add client test for `DaemonClient.cancel()`.
- Add WebUI controller tests for send/cancel status and event projection.
- Add shell/app tests for composer controls.
- Run targeted package tests.
- Run full repo verification.
- Run browser smoke.
- Run real remote WebUI smoke.

## Affected Paths

- `docs/ROADMAP.md`
- `docs/spec/daemon.md`
- `docs/spec/client.md`
- `docs/spec/ship/S0035-webui-prompt-control-smoke.md`
- `packages/protocol/src/wire.ts`
- `packages/protocol/src/index.test.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/protocol.test.ts`
- `packages/client/src/index.ts`
- `packages/client/src/daemon-client.test.ts`
- `apps/webui/src/remote-session.ts`
- `apps/webui/src/remote-session.test.ts`
- `apps/webui/src/app.ts`
- `apps/webui/src/app.test.ts`
- `apps/webui/src/shell.ts`

## Risks And Boundaries

- Cancel is best-effort. It aborts the runtime through `AbortController`; a provider or tool that ignores abort may finish before observing cancellation.
- Cancel is session-scoped. The daemon must not cancel a different session just because the same client is connected.
- The WebUI does not own session truth. It sends commands and renders daemon events; persistent state stays in daemon-owned JSONL.
