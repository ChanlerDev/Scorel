# S0068 GUI E2E Verification

Date: 2026-06-08

## Automated Product-Path Evidence

- `pnpm --filter @scorel/app-gui typecheck` passed.
- `pnpm --filter @scorel/app-gui test` passed.
- `pnpm --filter @scorel/app-gui build` passed.
- GUI local Host tests cover Project registration, Session creation, prompt send, persisted assistant response, and session-scoped transcript filtering.
- GUI Relay tests cover a real local Relay server, real `HostRelayClient`, authorized Relay Device discovery, remote directory browsing, explicit remote Project selection, remote Session creation, prompt send through Relay, and persisted assistant response.

Automated prompt tests use a deterministic test provider so CI stays stable. They still use the real Host, Relay, `DaemonClient`, JSONL, and Project registry path.

## Desktop Smoke

- `pnpm gui` launched Electron without main-process or renderer load errors.
- Electron exited cleanly after SIGTERM.
- Screenshot capture was attempted at desktop size, but the macOS automation permission dialog covered the app window. The screenshot was not committed because it contained unrelated desktop/browser content.

## Real Provider Smoke

Formal verifier:

```bash
pnpm verify:m9-gui
```

The verifier covers:

- real provider config loaded through `loadScorelConfig`.
- GUI embedded local Host service.
- local Project registration, Session creation, prompt send, and persisted assistant response.
- local Relay server.
- GUI Relay pair session creation.
- Host-side Relay pair redemption.
- remote Host outbound Relay connection through `HostRelayClient`.
- GUI Relay Device discovery.
- explicit remote Project selection.
- remote Session creation, prompt send through Relay, and persisted assistant response.

Result:

```text
ok: true
local projectId=prj_109119eb-9401-4d62-ba46-052e1a128fae sessionId=ses_62d6865d-67d7-4f77-9e27-375946ae4582 eventCount=5
relay deviceId=device_gui_m9_remote projectId=prj_d57f2c62-44dc-42ab-b21c-0fe151053109 sessionId=ses_d85f7028-daa9-406a-bfd7-77f159d0d031 eventCount=7
```

This proves the real-provider GUI prompt smoke completed for both the embedded local Host path and the Relay remote Project path. The verification command did not persist provider credentials into the repository.
