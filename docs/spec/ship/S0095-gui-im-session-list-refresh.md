# S0095: GUI IM Session List Refresh

## Goal

Make GUI sidebars show IM sessions that are created in the background by Telegram, QQ, or WeChat inbound messages.

## Scope

- Notify GUI when the local Host creates a session, including IM sessions created in the background.
- Refresh only the affected Project session list in response to that notification.
- Keep IM session storage and Project binding unchanged.
- Cover the selected/default IM workspace Project so background QQ/Telegram sessions appear without app restart.

## Not In Scope

- Changing where session JSONL files are stored.
- Creating per-platform Projects.
- Relay or hosted notification push for remote devices.

## Acceptance Criteria

- A GUI Project refreshes when the local Host reports a new session for that Project.
- The refresh does not clear the active transcript.
- Renderer test covers a background session appearing after initial load.

## Test Requirements

```bash
pnpm --filter @scorel/app-gui test -- src/renderer/app-session-preload.test.tsx
pnpm typecheck
pnpm test
```

## Status

Done.
