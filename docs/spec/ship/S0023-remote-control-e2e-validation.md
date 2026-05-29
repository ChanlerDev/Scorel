# S0023: Remote Control End-to-End Validation

## Goal

Validate the full M4 remote control product path end to end using real product behavior.

This spec closes M4 only after a local client can securely control a daemon running as a remote WebSocket endpoint, recover from disconnects, and complete a real coding flow without losing session state.

## Scope

- Build an end-to-end validation path that starts a daemon WebSocket endpoint, connects a client through remote transport, sends prompts, receives streamed events, disconnects, reconnects with `lastSeq`, and verifies missed event recovery.
- Use the same daemon, client, CLI, session, config, provider, and transport paths that users run.
- Verify token auth failure and success through the same product path.
- Verify persistent JSONL session state is owned by the daemon and remains correct after reconnect.
- Verify a real coding task in a real temporary workspace through a real LLM provider and a real JSONL session.
- Update `docs/ROADMAP.md` to mark M4 steps and M4 status Done only after this spec passes.

## Not In Scope

- Public Internet deployment guidance.
- TLS hardening or reverse proxy configuration.
- Remote profile persistence.
- WebUI / GUI validation.
- Daemon crash recovery after hard kill.
- Permission approval UI, sandbox, checkpoint restore.

## Acceptance Criteria

- A local CLI/client can connect to a daemon WebSocket endpoint using token auth.
- A prompt sent from the local client runs on the daemon-owned session and streams events back over WebSocket.
- A disconnected remote client can reconnect with `lastSeq` and receive missed events in order.
- If in-memory buffers cannot satisfy resync, daemon falls back to persistent JSONL session replay where applicable.
- Invalid tokens cannot observe or mutate session state.
- The validation proves remote transport, auth, event broadcast, request/response, and session persistence together.
- A real-provider validation proves the remote `scorel chat` product path with a real temporary workspace and real JSONL session.
- `pnpm typecheck && pnpm test` passes.
- `docs/ROADMAP.md` marks all M4 steps and M4 status as `Done` only after verification.

## Tests

- `pnpm --filter @scorel/client test`
- `pnpm --filter @scorel/daemon test`
- `pnpm --filter @scorel/app-cli test`
- `pnpm --filter @scorel/app-daemon test`
- `pnpm typecheck && pnpm test`
- Required real-provider validation before marking M4 Done: remote daemon WebSocket endpoint + real LLM provider + real temporary coding workspace + real JSONL session.

## Affected Paths

- `apps/cli/src/`
- `apps/daemon/src/`
- `packages/client/src/`
- `packages/daemon/src/`
- `packages/protocol/src/`
- `docs/ROADMAP.md`
- `docs/spec/client.md`
- `docs/spec/daemon.md`

## Risks And Boundaries

- A validation that only tests raw WebSocket messages does not prove user value. It must use `DaemonClient` and the product CLI path where possible.
- A remote validation without reconnect/resync does not close M4.
- Do not mark M4 Done while auth or reconnect remains only unit-tested in isolation.
- Do not use mock/fake providers as completion proof.
- Do not add test-only branches, special protocol messages, fake transports, or product behavior that exists only for validation.
- If real provider credentials are unavailable, record that limitation and keep M4 Planned.
