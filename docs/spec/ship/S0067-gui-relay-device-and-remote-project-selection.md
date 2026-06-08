# S0067: GUI Relay Device And Remote Project Selection

## Goal

Add the remote half of the GUI product model: Settings can add Relay Devices, and Add Project can browse a selected Relay Device and add only explicitly chosen remote Projects to the GUI Project list.

## Scope

- Add Settings UI for Relay Device management.
- Support the existing Relay pairing / authorization model.
- Persist GUI Device records and connector metadata locally.
- Connect to a Relay Device through `RelayTransport` / `DaemonClient`.
- Add Project flow can choose:
  - Local embedded Host.
  - A configured Relay Device.
- Browse remote directories through the selected Relay Device Host.
- Register the selected remote Project on that Host.
- Persist GUI-visible remote Project selection as `deviceId + projectId`.
- Show selected remote Projects in the main Project list alongside local Projects.
- Remote Project list must not automatically include every Project in the remote Host Registry.

## Non-Goals

- Do not implement SSH Remote Device.
- Do not implement direct WS + token as a GUI path.
- Do not add account login or OAuth.
- Do not move remote Project authority into Relay.
- Do not let Relay store Project, Session, prompt, tool result, Runtime, JSONL, or replay cache.

## Acceptance Criteria

- Settings can add a Relay Device using the official Relay default unless overridden for development.
- GUI can connect to the configured Relay Device and show connection status.
- Add Project can browse directories on the selected Relay Device.
- Registering a remote Project stores the returned `projectId` and marks it visible in GUI.
- The main Project list shows only GUI-selected remote Projects for that Relay Device.
- Removing or hiding a GUI-selected remote Project does not delete the remote Host Project unless a later spec explicitly adds destructive management.
- Local Projects remain all-visible.

## Test Requirements

Run:

```bash
pnpm --filter @scorel/app-gui typecheck
pnpm typecheck
pnpm test
git diff --check
```

Manual smoke must use:

- real Relay service or local Relay process
- real Host connected outbound to Relay
- real Relay Device configuration in GUI
- real remote directory browsing through Relay
- real remote Project registration

## Affected Paths

- `apps/gui/**`
- `packages/client/**`
- `packages/protocol/**` only if GUI-visible selection requires shared types
- `docs/ROADMAP.md`
- `docs/spec/ship/S0067-gui-relay-device-and-remote-project-selection.md`

## Risks

- Remote Project visibility can accidentally collapse back to WebUI behavior. The invariant is: remote Host Registry is not the GUI main Project list.
- Pairing and Device persistence can leak secrets. Do not log Relay tokens or full connector secrets.
- Relay may be mistaken for a cloud backend. It remains only proxy + authorization registry.
