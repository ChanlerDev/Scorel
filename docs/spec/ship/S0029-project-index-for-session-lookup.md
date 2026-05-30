# S0029: Project Index For Session Lookup

## Goal

Add a lightweight project index so CLI and future GUI surfaces can organize local and remote sessions by project instead of by storage path shape.

Session JSONL, daemon diagnostics, attach cache, and attach diagnostics already live in different physical locations. S0029 adds one lookup file that maps project identity to those existing session assets without migrating or duplicating them.

## Scope

- Add one index file:
  - `<stateDir>/project-index.json`
- Do not add a `projects/` directory.
- Do not move existing files:
  - `<stateDir>/sessions/<sessionId>.jsonl`
  - `<stateDir>/sessions/<sessionId>.log`
  - `<stateDir>/attach-cache/<scopeKey>/<sessionId>.json`
  - `<stateDir>/attach-cache/<scopeKey>/<sessionId>.log`
- Treat project as the user-facing organization unit:
  - local project identity is the canonical CLI `workDir`
  - remote project identity is the remote daemon `projectSlug`
  - `deviceId` is a namespace/disambiguator for remote devices with the same `projectSlug`
  - `deviceDisplayName` and project display names are UI metadata, not identity
  - remote URL is only the latest connection endpoint, not identity
- Update the project index from:
  - `scorel chat` for local sessions
  - local `scorel attach` for local attach cache/logs
  - remote `scorel attach` for remote attach cache/logs
- Use the project index for attach log lookup before falling back to legacy attach-cache scanning.

## Not In Scope

- GUI project browser.
- Moving session/cache/log files into project directories.
- Remote retrieval of daemon-owned session JSONL or daemon diagnostics.
- Global search, retention, rotation, or compaction of index data.
- Making the index authoritative session state.

## Index Shape

```json
{
  "version": 1,
  "projects": [
    {
      "projectKey": "local:/Users/chanler/Scorel",
      "kind": "local",
      "workDir": "/Users/chanler/Scorel",
      "displayName": "Scorel",
      "lastSeenAt": 1716000000000,
      "sessions": {
        "ses_local": {
          "sessionId": "ses_local",
          "source": "local-session",
          "sessionPath": "sessions/ses_local.jsonl",
          "logPath": "sessions/ses_local.log",
          "lastSeenAt": 1716000000000
        }
      }
    },
    {
      "projectKey": "remote:device_vps:scorel",
      "kind": "remote",
      "deviceId": "device_vps",
      "deviceDisplayName": "Tokyo VPS",
      "projectSlug": "scorel",
      "displayName": "scorel",
      "lastRemoteUrl": "wss://example.invalid",
      "lastSeenAt": 1716000000000,
      "sessions": {
        "ses_remote": {
          "sessionId": "ses_remote",
          "source": "attach-cache",
          "cachePath": "attach-cache/abc123/ses_remote.json",
          "logPath": "attach-cache/abc123/ses_remote.log",
          "lastSeenAt": 1716000000000
        }
      }
    }
  ]
}
```

The index stores relative paths from `<stateDir>` so it remains portable across test temp dirs and product roots.

## Acceptance Criteria

- `scorel chat --cwd <dir> --session <id>` records a local project entry keyed by the canonical `workDir`.
- local `scorel attach --session <id>` records a local project/session entry with attach cache and attach log paths.
- remote `scorel attach --remote <url> --session <id>` records a remote project entry keyed by `remote:<deviceId>:<projectSlug>`.
- Remote project display/organization uses `projectSlug`; `deviceId` only disambiguates devices.
- `lastRemoteUrl` is recorded but does not participate in identity.
- `scorel logs --attach --session <id> --remote <url>` can resolve the attach diagnostics log through `project-index.json`.
- If index lookup is unavailable, legacy attach-cache scanning remains as a compatibility fallback.
- Existing session and attach cache/log paths remain unchanged.
- `pnpm typecheck && pnpm test` passes.

## Tests

- Add CLI tests for local chat writing `project-index.json` with canonical workDir and session log path.
- Add CLI tests for remote attach writing remote project index entries with `projectSlug`, `deviceId`, `lastRemoteUrl`, cache path, and log path.
- Add CLI tests for `scorel logs --attach` reading via project index.
- Run targeted CLI tests.
- Run `pnpm typecheck && pnpm test`.

## Affected Paths

- `docs/ROADMAP.md`
- `docs/spec/client.md`
- `docs/spec/session.md`
- `docs/spec/ship/S0029-project-index-for-session-lookup.md`
- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`

## Risks And Boundaries

- Index writes must not make session/cache writes authoritative or fragile. If the index is missing or corrupt, commands should keep working where possible.
- Multiple projects may contain the same random `sessionId`. Lookup must prefer matching remote URL/project metadata where available and avoid silently selecting the wrong project when ambiguity is detectable.
- The index can be rebuilt later from existing files and metadata; S0029 only creates and updates it opportunistically on product paths.
