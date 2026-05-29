# S0027: Session Diagnostics Log

## Goal

Add a per-session diagnostics log so provider, runtime, daemon, and reconnect failures are visible without overloading session JSONL or attach cache.

Session JSONL remains the replayable product record. Attach cache remains a client-side terminal recovery aid. Diagnostics logs are daemon-owned debugging evidence stored beside the daemon session file.

## Scope

- Store a diagnostics log beside each daemon-owned session JSONL file:
  - session: `<sessionsDir>/<sessionId>.jsonl`
  - diagnostics log: `<sessionsDir>/<sessionId>.log`
- Use append-only plain text `.log` lines, one log entry per line.
- Keep lines human-readable and grep-friendly, with stable key/value fields where useful.
- Record enough detail to debug failed real-provider turns:
  - session create/load
  - client connect/disconnect identity
  - `send_message` start/end
  - runtime turn start/end
  - provider-visible assistant result summary
  - runtime/provider errors with message and short stack
  - resync mode and anchor values
- Keep logs on the machine that owns the daemon session:
  - embedded/local daemon logs live beside local session JSONL
  - remote daemon logs live beside remote session JSONL
  - local attach cache does not store daemon diagnostics
- Add a minimal CLI read path for local files, enough to inspect the current machine's session diagnostics.

## Not In Scope

- Log levels, log rotation, retention policy, compression, or upload.
- GUI log viewer.
- Remote log retrieval over the daemon protocol.
- Logging full prompt text, full tool results, full provider payloads, or secrets.
- Changing the session JSONL event schema.
- Making attach cache authoritative or diagnostic.

## Acceptance Criteria

- Creating or loading a session can create/use `<sessionsDir>/<sessionId>.log` beside `<sessionId>.jsonl`.
- `send_message` writes start and finish log lines including `sessionId`, `clientId`, and resulting event ids.
- Runtime/provider errors write a line containing the error message and a short stack excerpt.
- Assistant result log lines include `stopReason`, text block count, tool call count, and usage when present.
- `resync_events` writes a line with recovery mode, `persistentLastSeq`, `streamLastSeq`, `throughSeq`, and returned event count.
- Connect/disconnect logs include client id, daemon `deviceId`, optional display name, and project slug when available.
- Logs do not include bearer tokens or API keys.
- `scorel logs --session <id>` can print the local `<sessionId>.log`; `--tail <n>` limits output to the last `n` lines.
- `pnpm typecheck && pnpm test` passes.

## Tests

- Add core session tests for log file path derivation beside session JSONL.
- Add daemon tests proving `send_message`, runtime error, and resync write diagnostics lines.
- Add CLI tests for `scorel logs --session <id>` and `--tail <n>`.
- Run targeted package tests.
- Run `pnpm typecheck && pnpm test`.

## Affected Paths

- `docs/ROADMAP.md`
- `docs/spec/session.md`
- `docs/spec/daemon.md`
- `docs/spec/ship/S0027-session-diagnostics-log.md`
- `packages/core/src/session/index.ts`
- `packages/core/src/session/session.test.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/protocol.test.ts`
- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`

## Risks And Boundaries

- Logs can leak sensitive data if they capture raw prompts, tool results, provider payloads, tokens, or API keys. S0027 must prefer summaries and explicit error messages over raw payload dumps.
- Plain `.log` is intentionally less structured than session JSONL. Keep key names stable enough for grep, but do not turn this into a second event protocol.
- Remote diagnostics remain on the remote daemon host until a future spec adds remote log retrieval. S0027 should not silently copy remote logs into local attach cache.
- Rich logging can become noisy. Keep the first version focused on lifecycle, recovery, result summaries, and errors.
