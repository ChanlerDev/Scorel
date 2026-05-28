# S0015: Local Attach And Broadcast

## Goal

Let local CLI clients attach to the standalone daemon and observe the same session event stream.

This spec proves that M3 is more than a background process: multiple local clients share one daemon-owned session.

## Scope

- Add `scorel attach` for connecting to an existing local daemon.
- Let `scorel chat` choose the local standalone daemon path when requested, while preserving the embedded default until the product default is intentionally changed.
- Support attaching to a specific session with `--session`.
- Broadcast persistent and transient events from one local client to all clients attached to the same session.
- Keep session writes daemon-owned; CLI must not bypass the daemon to read/write JSONL directly.
- Show CLI-visible tool calls, tool results, text deltas, and daemon errors through the existing event stream.
- Add integration tests with two local clients attached to one daemon/session.

## Not In Scope

- Remote attach.
- Browser/WebUI attach.
- Rewind/branch UX polish.
- Permission levels between local clients.
- Offline command queue.
- Automatically migrating all `scorel chat` usage to standalone daemon by default.

## Acceptance Criteria

- `scorel attach --session <id>` connects to an already-running local daemon and subscribes to that session.
- When Client A sends a message, Client B receives the same ordered event stream for that session.
- Tool call and tool result events remain visible in attached clients.
- A client connecting to a missing daemon receives a clear error.
- A client connecting to a missing session can either create it through the daemon or report the supported command path; the behavior is documented in the spec/client or CLI help text.
- Tests prove CLI code uses `DaemonClient` + transport and does not directly instantiate runtime/session for attach.

## Tests

- `pnpm --filter @scorel/client test`
- `pnpm --filter @scorel/daemon test`
- `pnpm --filter @scorel/app-cli test`
- `pnpm typecheck && pnpm test`

## Affected Paths

- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`
- `packages/client/src/`
- `packages/daemon/src/`
- `docs/spec/client.md`
- `docs/spec/daemon.md`
- `docs/ROADMAP.md`

## Risks And Boundaries

- Attach UX can become a second chat implementation. Keep it as a thin client path over `DaemonClient`.
- Multi-client output can become noisy. Preserve machine-verifiable event behavior first; polish display later.
- Do not add remote URI parsing here beyond local daemon discovery.
