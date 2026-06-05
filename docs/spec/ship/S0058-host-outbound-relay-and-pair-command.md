# S0058: Host Outbound Relay And Pair Command

## Goal

Let a local Scorel Host connect outbound to Relay and let the user authorize an Entry with `scorel pair <code>`.

After this spec, a Host can be online behind Relay and Relay can route authorized daemon wire payloads into the existing Host handler.

## Scope

- Add Host-side Relay adapter under `packages/daemon/src/relay/`.
- Add `scorel pair <pairCode>` command wiring in `apps/cli`.
- Load or create stable Host `deviceId` using the existing Device identity path.
- Connect Host outbound to Relay:

```text
Host -> Relay: host_hello(deviceId)
```

- Redeem pair code:

```text
scorel pair <code> --relay <relayUrl>
  -> Host identity loaded/created
  -> Relay redeem_pair(pairCode, deviceId)
  -> Relay binding deviceId -> clientId created
  -> Host records authorized clientId locally when Relay returns it
```

- Add local Host allowlist storage for authorized `clientId` values.
- Implement Host relay adapter:
  - receive `{ clientId, payload: RelayClientPayload }` frames from Relay
  - handle the existing daemon `connect` handshake as a relay payload so `DaemonClient.connect()` enters the normal Host connection set
  - construct a logical daemon connection context using `clientId`
  - pass payload into the existing Host request handler
  - send `{ clientId, payload: DaemonMessage }` frames back to Relay
- Do not create a separate Relay-only Host API.
- Add diagnostics for Relay connection lifecycle without prompt/tool payloads.

## Non-Goals

- `RelayTransport` in `@scorel/client`.
- WebUI pairing UI.
- Hosted WebUI device list.
- Relay user accounts.
- Keypair/signature proof.
- Background supervisor for reconnect forever.
- Changing Session JSONL schema.
- Changing `user_message.clientId` semantics beyond using stable Entry `clientId`.

## Contract

Host outbound connection:

```text
scorel daemon serve --relay <relayUrl>
  -> starts normal Host
  -> opens Relay host socket
  -> announces deviceId
  -> accepts authorized Relay frames
```

Pair command:

```text
scorel pair <pairCode> --relay <relayUrl>
```

Required behavior:

- If local Host identity does not exist, create it.
- If Relay rejects the pair code, print a clear error and do not mutate allowlist.
- If pair succeeds, persist the authorized `clientId` locally.
- Re-running pair for an already authorized `clientId` is idempotent.

Host allowlist:

```typescript
type HostRelayAuthFile = {
  version: 1;
  clients: Array<{
    clientId: ClientId;
    createdAt: number;
    label?: string;
  }>;
};
```

Default location should be under `~/.scorel` and must be documented in the implementation spec if it differs.

## Acceptance Criteria

- `scorel pair <code> --relay <relayUrl>` can redeem a pair session created by Relay.
- Host stores authorized `clientId` locally after successful pair.
- Host can connect outbound to Relay and appear online.
- Relay can send an authorized `RelayClientPayload` frame to Host.
- Host routes that payload through the existing daemon handler.
- Host sends the resulting `DaemonMessage` frame back through Relay.
- Unrecognized `clientId` is rejected by Host even if Relay sends a frame.
- No Project, Session, Runtime, replay, or context-build logic exists in the relay adapter.

## Test Requirements

- Host relay adapter tests use the real Host object and real Relay frame types.
- CLI tests cover:
  - missing pair code
  - invalid Relay response
  - successful pair
  - idempotent already-authorized pair
- Integration test uses a real local Relay server from `apps/relay` and a real Host with temp `~/.scorel`.
- Tests cover a simple daemon request such as `get_status` through Relay.
- Run:

```bash
pnpm --filter @scorel/daemon test
pnpm --filter @scorel/cli test
pnpm --filter @scorel/relay test
pnpm typecheck
```

## Affected Paths

- `packages/daemon/src/relay/host-client.ts`
- `packages/daemon/src/relay/auth.ts`
- `packages/daemon/src/relay/pair.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/index.test.ts`
- `apps/cli/src/relay-cli.ts`
- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`
- `apps/relay/src/*`
- `packages/protocol/src/relay.ts`

## Risks

- Host relay adapter could accidentally become a second daemon protocol path. Keep it as a frame adapter around existing Host handlers.
- Host allowlist and Relay binding can drift. V1 accepts explicit re-pairing as recovery.
- Long-running outbound reconnect can grow too broad. Keep lifecycle minimal and testable.
