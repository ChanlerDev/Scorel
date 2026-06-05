# S0059: RelayTransport And Hosted WebUI Connector

## Goal

Let an Entry use Relay to connect to a paired Device through the existing `DaemonClient` contract, and let WebUI manage Relay-backed Devices alongside direct WS Devices.

After this spec, WebUI can pair with a Device through Relay, list authorized Relay Devices, open a Relay-backed `DaemonClient`, and use existing Project / Session flows through that connection.

## Scope

- Add `RelayTransport` in `packages/client`.
- `RelayTransport` implements the existing `DaemonTransport` interface.
- `RelayTransport`:
  - opens an Entry socket to Relay
  - announces stable `clientId`
  - sends `{ deviceId, payload: ClientMessage }` frames
  - receives `DaemonMessage` payloads
  - maps Relay errors to existing client transport errors where possible
- Add stable WebUI `clientId` storage.
- Extend WebUI Device store from one `link + token` to a connector model that can represent:
  - direct WS connector
  - Relay connector
- Merge Devices by `remoteIdentity.deviceId`.
- Add hosted WebUI pairing flow:
  - create pair session through Relay
  - show pair code
  - wait for pair completion / authorized Device presence
  - add or merge Relay connector for that Device
- Add Relay device discovery:

```text
list_authorized_devices(clientId)
  -> [{ deviceId, label?, online }]
```

- Use Relay connector through the existing WebUI connection pool.
- Keep direct local WS as preferred connector when healthy.

## Non-Goals

- Implement Relay service internals beyond what S0057 provides.
- Implement Host outbound adapter beyond S0058.
- User accounts.
- Fine-grained permissions.
- Desktop GUI.
- SSH remote Device.
- Changing transcript rendering, composer behavior, or Session event projection.
- Changing JSONL schema.

## Contract

Entry-side transport:

```typescript
const transport = new RelayTransport({
  relayUrl,
  deviceId,
  clientId,
});

const client = new DaemonClient(transport, options);
await client.connect(sessionId);
```

WebUI Device model:

```typescript
type DeviceConnector =
  | { kind: "direct_ws"; url: string; token: string }
  | { kind: "relay"; relayUrl: string; deviceId: DeviceId; clientId: ClientId };
```

Connection selection:

1. Prefer healthy direct WS.
2. Use Relay when direct is unavailable and Relay says Device is online.
3. Render offline cached state when no connector is reachable.

Cache scope:

```text
deviceId + projectId + sessionId
```

Connector URL or Relay URL must not create a separate cache namespace for the same Host.

## Acceptance Criteria

- `RelayTransport` passes the same core behavior tests expected of `DaemonTransport`.
- WebUI can store a stable `clientId`.
- WebUI can create a Relay pair session and display the pair code.
- WebUI can add a Relay connector after pair succeeds.
- WebUI merges a direct and Relay connector when they resolve to the same `deviceId`.
- WebUI uses existing `syncProjects`, `syncSessions`, `sendMessage`, and `resync` through `DaemonClient` without Relay-specific forks above transport.
- WebUI shows Relay-backed Device online/offline state from Relay presence.
- Direct WS continues to work unchanged.

## Test Requirements

- `packages/client` tests cover:
  - RelayTransport connect
  - request/response correlation through Relay
  - event delivery through Relay
  - Relay offline / unauthorized errors
  - disconnect cleanup
- WebUI store tests cover:
  - stable `clientId`
  - connector add/update/remove
  - merge by `remoteIdentity.deviceId`
  - cache scope independent of connector kind
- WebUI connection pool tests cover connector selection and fallback.
- WebUI pairing UI tests cover create pair session, show code, pair success, pair failure, and timeout.
- Integration tests use real local Relay and Host where possible.
- Run:

```bash
pnpm --filter @scorel/client test
pnpm --filter @scorel/webui test
pnpm --filter @scorel/relay test
pnpm typecheck
```

## Affected Paths

- `packages/client/src/relay-transport.ts`
- `packages/client/src/index.ts`
- `packages/client/src/relay-transport.test.ts`
- `apps/webui/lib/store/devices.ts`
- `apps/webui/lib/store/client-identity.ts`
- `apps/webui/lib/connection/pool.ts`
- `apps/webui/components/settings/*`
- `apps/webui/components/shell/*`
- `apps/webui/lib/sync/*`
- `apps/webui/src/package-boundaries.test.ts`

## Risks

- WebUI Device store migration can split one real Device into duplicates. Merge by `deviceId` once known.
- Relay-specific UI branches can leak above `DaemonClient`. Keep connector handling below connection acquisition.
- Pairing UI can imply Relay owns Projects. Keep Project/Session sync explicitly Host-backed.
