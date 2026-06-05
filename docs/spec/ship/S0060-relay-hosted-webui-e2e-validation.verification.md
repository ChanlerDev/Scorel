# S0060 Verification Note: Relay Hosted WebUI E2E

Date: 2026-06-05

## Result

S0060 is not complete yet.

The implementation path for S0057-S0059 is in place and the full automated workspace verification passes, but the required real provider E2E path was not run because this environment does not have `SCOREL_API_KEY` configured.

S0060 explicitly requires a real Relay + Host + WebUI + LLM provider validation and does not accept a fake provider as M8 completion proof. Therefore M8 must remain Planned until the real provider path passes.

## Automated Verification Completed

Command:

```bash
pnpm typecheck && pnpm test
```

Result: passed.

Coverage included:

- `@scorel/protocol`: relay frame schemas and message contracts.
- `@scorel/relay`: real local WebSocket Relay pair, binding, presence, routing, and diagnostics.
- `@scorel/daemon`: Host outbound Relay adapter, pair command support, device identity, and Relay authorization persistence.
- `@scorel/client`: `RelayTransport` connect/send/resync behavior against a real local Relay.
- `@scorel/app-webui`: Relay connector storage, pairing panel, connection fallback, stable Entry client identity, Project/Session sync, and direct connector regression coverage.
- Full workspace typecheck.

Observed non-failing warnings:

- Existing React `act(...)` warnings in WebUI DeviceList and ProjectPage tests.
- Expected malformed/invalid state error logs in `/api/local-daemon` tests.

## Blocker

`SCOREL_API_KEY` is missing in this environment.

Because of that, the following S0060 acceptance criteria remain unverified:

- WebUI sends a prompt through Relay to a real LLM provider.
- Host writes the resulting real session JSONL under Host-owned state.
- WebUI receives the real assistant stream through Relay.
- WebUI refresh/reconnect recovers the real session through Host-owned resync.
- Relay store/log audit after a real prompt confirms no prompt, tool result, session JSONL, provider response, or replay cache is stored.

## Manual Completion Path

Run this path when a real provider key is available:

```bash
export SCOREL_API_KEY=...

pnpm typecheck && pnpm test

RELAY_DATA_DIR="$(mktemp -d)"
SCOREL_RELAY_PORT=8787 SCOREL_RELAY_DATA_DIR="$RELAY_DATA_DIR" pnpm --filter @scorel/relay start
```

In a second terminal:

```bash
HOST_STATE_DIR="$(mktemp -d)"
pnpm scorel daemon serve --port 0 --state-dir "$HOST_STATE_DIR" --cwd /path/to/real/project --relay ws://127.0.0.1:8787
```

In a third terminal:

```bash
pnpm --filter @scorel/app-webui dev
```

Then complete the browser path:

1. Open WebUI Settings.
2. Add Relay URL `ws://127.0.0.1:8787`.
3. Create a pair code.
4. Run:

```bash
pnpm scorel pair <pair-code> --relay ws://127.0.0.1:8787
```

5. Refresh Relay devices in WebUI.
6. Open the paired Relay Device.
7. Select or add a real Project.
8. Create a Session.
9. Send a real prompt.
10. Refresh the browser and verify the Session resyncs.

Expected evidence:

- WebUI shows the Relay Device online.
- WebUI can list Host Projects through Relay.
- WebUI can create or open a Session through Relay.
- A real assistant event stream appears in WebUI.
- Session JSONL exists under `$HOST_STATE_DIR`, not `$RELAY_DATA_DIR`.
- The persisted `user_message.clientId` is the WebUI Entry client id.
- Relay durable store contains device/client binding and presence/routing metadata only.
- Relay logs/store contain no prompt text, tool result payload, session JSONL, provider response, or replay cache.

