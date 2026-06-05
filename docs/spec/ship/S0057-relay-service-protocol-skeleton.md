# S0057: Relay Service Protocol Skeleton

## Goal

Create the first runnable Relay service slice:

- `apps/relay` exists as the deployable Relay process.
- `packages/protocol` exposes Relay frame and store record types.
- Relay can accept Entry and Host presence sockets.
- Relay can create/redeem pair sessions and persist `deviceId -> clientId` bindings.
- Relay can proxy existing daemon wire payloads between an authorized Entry and an online Host.

This spec proves the Relay proxy model without touching Host runtime behavior or WebUI product flows.

## Scope

- Add `apps/relay` to the workspace.
- Add `packages/protocol/src/relay.ts` and export it from `@scorel/protocol`.
- Define Relay frame types around existing `ClientMessage` / `DaemonMessage` payloads:

```typescript
type RelayEntryFrame =
  | { type: "entry_hello"; clientId: ClientId }
  | { type: "create_pair_session"; requestId: string; clientId: ClientId }
  | { type: "entry_to_device"; deviceId: DeviceId; payload: ClientMessage }
  | { type: "list_authorized_devices"; requestId: string };

type RelayHostFrame =
  | { type: "host_hello"; deviceId: DeviceId }
  | { type: "redeem_pair"; requestId: string; pairCode: string; deviceId: DeviceId }
  | { type: "host_to_entry"; clientId: ClientId; payload: DaemonMessage };
```

- Define Relay responses/errors with structured `requestId`, `code`, and `message`.
- Implement Relay process entrypoint and WebSocket server in `apps/relay`.
- Implement a Relay store interface:

```typescript
interface RelayStore {
  upsertDevice(record: RelayDeviceRecord): Promise<void>;
  upsertClient(record: RelayClientRecord): Promise<void>;
  bind(input: { deviceId: DeviceId; clientId: ClientId }): Promise<void>;
  isBound(input: { deviceId: DeviceId; clientId: ClientId }): Promise<boolean>;
  listDevicesForClient(clientId: ClientId): Promise<RelayDeviceRecord[]>;
}
```

- Provide a file-backed store for local/dev use and tests using a temp data directory.
- Keep pair sessions and presence in memory.
- Route Entry payloads only when:
  - Entry socket announced a `clientId`.
  - Relay binding exists for `(deviceId, clientId)`.
  - Host socket for `deviceId` is online.
- Route Host responses back to online sockets for `clientId`.
- Add relay diagnostics that never log payload content.

## Non-Goals

- Host outbound Relay adapter.
- `scorel pair` CLI command.
- `RelayTransport` in `@scorel/client`.
- Hosted WebUI pairing UI.
- User accounts.
- Cryptographic signatures or key rotation.
- End-to-end encryption beyond the current WebSocket transport.
- Project, Session, Runtime, replay, or resync logic inside Relay.

## Contract

Relay durable state:

```text
devices
clients
bindings(deviceId, clientId)
```

Relay transient state:

```text
pairSessions(pairCode -> clientId)
presence.devices(deviceId -> hostSocket)
presence.clients(clientId -> entrySocket[])
```

Relay routing:

```text
entry_to_device(deviceId, payload)
  -> check binding(deviceId, clientId)
  -> check device online
  -> host socket receives { clientId, payload }

host_to_entry(clientId, payload)
  -> entry sockets for clientId receive payload
```

Pair code rules:

- short-lived
- single-use
- random enough for local/dev use
- invalidated after redeem
- safe to lose on Relay process restart

## Acceptance Criteria

- `pnpm --filter @scorel/relay test` runs Relay unit/integration tests.
- Relay can start with a temp data directory.
- Entry socket can create a pair session.
- Host socket can redeem the pair code.
- Store persists the binding.
- Entry can list its authorized Device.
- Relay refuses unbound Entry -> Device routing.
- Relay refuses routing to an offline Device.
- Relay forwards an authorized `ClientMessage` payload to the Host socket.
- Relay forwards a Host `DaemonMessage` payload back to the Entry socket.
- Relay diagnostics do not include prompt/tool payload bodies.

## Test Requirements

- Protocol tests cover Relay frame type exports and browser-safety imports.
- Relay server tests use a real local WebSocket server, real client sockets, and a temp file store.
- Tests cover:
  - create/redeem pair
  - pair code expiry
  - pair code single-use
  - authorized routing
  - unbound routing rejection
  - offline device rejection
  - host response fan-out to one or more Entry sockets for the same `clientId`
- Run:

```bash
pnpm --filter @scorel/protocol test
pnpm --filter @scorel/relay test
pnpm typecheck
```

## Affected Paths

- `apps/relay/package.json`
- `apps/relay/tsconfig.json`
- `apps/relay/vitest.config.ts`
- `apps/relay/src/index.ts`
- `apps/relay/src/server.ts`
- `apps/relay/src/store.ts`
- `apps/relay/src/pairing.ts`
- `apps/relay/src/presence.ts`
- `apps/relay/src/routing.ts`
- `apps/relay/src/diagnostics.ts`
- `packages/protocol/src/relay.ts`
- `packages/protocol/src/index.ts`
- `packages/protocol/src/browser-safety.test.ts`
- `pnpm-lock.yaml`

## Risks

- Overbuilding Relay service before Host/WebUI integrate it. Keep this spec focused on proxy mechanics.
- Accidentally logging daemon payload content. Diagnostics must summarize routing metadata only.
- Treating file store as production storage. It is only the local/dev durable adapter for V1.
