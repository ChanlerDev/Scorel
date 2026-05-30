# S0028: Client Attach Diagnostics Log

## Goal

Add a client-side attach diagnostics log so local clients can debug remote attach, reconnect, cache, and rendering behavior without SSH access to the remote daemon host.

S0027 added daemon-owned session diagnostics beside daemon session JSONL. S0028 adds the complementary client-owned attach diagnostics beside the local attach cache.

## Scope

- Store attach diagnostics beside the local attach cache file:
  - cache: `<stateDir>/attach-cache/<scopeKey>/<sessionId>.json`
  - attach diagnostics: `<stateDir>/attach-cache/<scopeKey>/<sessionId>.log`
- Use append-only plain text `.log` lines, one log entry per line.
- Keep remote and local attach on the same logging path.
- Record client-side attach lifecycle and transport-visible behavior:
  - cache scope resolution
  - cache read/write summaries
  - connect start/success/failure, with token redacted
  - daemon connection identity (`deviceId`, `deviceDisplayName`, `projectSlug`)
  - load/create session result
  - resync anchors and resync mode
  - inbound events rendered by attach, including event type and seq
  - outbound user input send start/finish/error
  - disconnect/exit
- Permit richer payload logging than S0027 because session JSONL already stores product data, but never log bearer tokens, API keys, or local secret tokens.
- Add a CLI read path for attach logs.

## Not In Scope

- Remote retrieval of daemon-side `<sessionId>.log`.
- Log rotation, retention, compression, upload, or GUI.
- Making attach logs authoritative replay state.
- Changing attach cache JSON shape beyond metadata needed to find the sibling log.
- Recording raw secrets.

## Acceptance Criteria

- Running `scorel attach --remote ...` writes `<stateDir>/attach-cache/<scopeKey>/<sessionId>.log` next to the attach cache JSON.
- The attach log includes cache scope identity, connect success, daemon identity, resync mode, rendered inbound events, send start/finish, and disconnect.
- Token values are not present in attach diagnostics.
- Local attach also writes a sibling attach diagnostics log under its local scope.
- `scorel logs --attach --session <id> --remote <url>` can print the local attach diagnostics log for the matching remote `deviceId + projectSlug` scope after at least one connect has resolved that identity.
- `scorel logs --attach --session <id> --tail <n>` can print local attach diagnostics for local attach scope.
- Existing `scorel logs --session <id>` keeps reading daemon-side session diagnostics.
- `pnpm typecheck && pnpm test` passes.

## Tests

- Add CLI tests that run remote attach twice through different endpoints with the same daemon identity and verify the attach log is reused beside the cache.
- Add CLI tests that assert attach logs contain lifecycle entries and do not contain the token.
- Add CLI tests for `scorel logs --attach --session <id> --remote <url> --tail <n>`.
- Run targeted CLI tests.
- Run `pnpm typecheck && pnpm test`.

## Affected Paths

- `docs/ROADMAP.md`
- `docs/spec/client.md`
- `docs/spec/session.md`
- `docs/spec/ship/S0028-client-attach-diagnostics-log.md`
- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`

## Risks And Boundaries

- Attach logs can grow quickly if every event is logged in full. S0028 should log enough payload context to debug, but keep one-line entries grep-friendly.
- Attach logs are local client evidence. They can prove what the client saw and rendered, but not provider/runtime internals on the remote daemon host.
- Remote URL alone is not stable identity. When daemon identity is known, attach diagnostics must use the same `deviceId + projectSlug` scope as attach cache.
- Secret redaction must be explicit and tested.
