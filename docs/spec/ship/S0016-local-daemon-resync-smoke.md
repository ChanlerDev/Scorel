# S0016: Local Daemon Resync Smoke

## Goal

Validate the full M3 local daemon product path: local daemon, multiple clients, disconnect/reconnect, missed event 补发, and a real `scorel chat` coding flow.

This spec closes M3 only after local daemon behavior is proven end to end.

## Scope

- Implement and test `lastSeq`-based resync over local socket transport.
- Cover the three M3 sync cases needed locally: buffer hit, JSONL persistent fallback, and clean full replay when a client has no usable seq.
- Verify that transient loss does not corrupt final persistent session state.
- Add an end-to-end CLI smoke using a real LLM provider, a real temporary workspace, local standalone daemon, and real JSONL session files.
- Verify the smoke includes search/read/edit/bash/TodoWrite through the local daemon path.
- Update M3 Roadmap status only after the smoke and full check pass.

## Not In Scope

- Remote WebSocket reconnect.
- Runtime in-progress partial reconstruction beyond what is already available through local event buffering.
- Long-running background Bash monitor.
- Daemon crash recovery after hard kill.
- GUI/WebUI validation.

## Acceptance Criteria

- A disconnected local client can reconnect with `lastSeq` and receive missed events in order.
- If the in-memory buffer cannot satisfy `lastSeq`, daemon falls back to JSONL persistent events and returns a correct final session state.
- Reconnect without `lastSeq` can rebuild state through full session replay.
- Tests prove seq remains per-session and does not leak across sessions.
- The real-provider smoke uses the local standalone daemon path, not embedded daemon and not mock/fake provider.
- Smoke artifacts include the temporary config path, workspace path, session id, and JSONL session path.
- `pnpm typecheck && pnpm test` passes.
- `docs/ROADMAP.md` marks all M3 steps and M3 status as `Done`.

## Tests

- `pnpm --filter @scorel/client test`
- `pnpm --filter @scorel/daemon test`
- `pnpm --filter @scorel/app-cli test`
- `pnpm --filter @scorel/app-daemon test`
- `pnpm typecheck && pnpm test`
- Manual smoke: local standalone daemon + real provider + real temporary coding workspace.

## Affected Paths

- `packages/client/src/`
- `packages/daemon/src/`
- `apps/cli/src/index.ts`
- `apps/daemon/src/index.ts`
- `docs/ROADMAP.md`
- `docs/spec/client.md`
- `docs/spec/daemon.md`

## Risks And Boundaries

- A smoke that uses embedded daemon does not prove M3. It must go through local standalone daemon transport.
- A resync test that only checks request/response shape does not prove user value. It must assert ordered event recovery and final session state.
- Do not use a fake provider as M3 completion proof; fake providers are only acceptable for unit tests.
