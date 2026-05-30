# S0035: WebUI Device Connection Handshake

## Goal

Wire the configured `Device` list to real `DaemonClient + WsTransport` connections. After this spec, opening a Device in the sidebar establishes a WebSocket connection, the daemon's identity (`deviceId`, `deviceDisplayName`) is captured into `Device.remoteIdentity`, and connection status is visible. No project/session listing yet.

## Scope

- Connection pool in `apps/webui/lib/connection/pool.ts`:
  - Owns one `DaemonClient` instance per `Device.id`.
  - Lazily creates a client when the user navigates to `/devices/:deviceId` (or descendants).
  - Methods: `acquire(deviceId): ManagedConnection | undefined`, `release(deviceId)`, `subscribe(deviceId, listener)`.
  - Uses `WsTransport` from `@scorel/client` with `link` and `token` from the device record.
  - Reuses an existing client if present and not in `error`/`disconnected` terminal state.
- Connection state machine in `apps/webui/lib/connection/state.ts`:
  - States: `idle` → `connecting` → `connected` → (`reconnecting` | `disconnected` | `error`).
  - Transitions driven by `DaemonClient` callbacks (`onConnected`, `onDisconnect`, `onError` if present; otherwise wrap `connect()` promise + `state` getter from the existing client API).
  - `error` carries a categorized reason: `auth | network | version_mismatch | unknown`. Categorization rules:
    - `auth` ↔ daemon error code `auth_failed` / HTTP 401-equivalent close codes.
    - `network` ↔ ws close code 1006 / DNS / TCP errors.
    - `version_mismatch` ↔ daemon `protocolVersion` field disagreement.
    - else `unknown`.
- Identity capture:
  - On successful handshake (`connected` daemon message), update `Device.remoteIdentity = { deviceId, deviceDisplayName }` via the devices store; also update `Device.lastConnectedAt`.
  - The handshake-supplied `defaultProjectSlug` (if any from S0032) is ignored here — projects are populated in S0036.
- UI:
  - `components/shell/sidebar.tsx` Device node shows live status: dot color + tooltip text matching the state machine state.
  - `app/devices/[deviceId]/page.tsx` shows a "Connecting…" / "Connected as <displayName>" / "Error: <reason>" banner.
  - "Reconnect" button on error/disconnected; "Disconnect" on connected (manual disconnect transitions to `idle`).
  - Switching device in the sidebar does not eagerly connect every other device; only the current route's device is acquired. Other devices stay `idle` unless previously connected (then keep their already-open ws). Lifetime: when the user navigates away from a device for more than 60 seconds, release its connection. (Make this delay a constant for now; adjust later.)
- Errors:
  - Auth failure: show "Token rejected; update token in Settings". Link to `/settings/devices/:deviceId`.
  - Network failure: show "Cannot reach <host>; will retry". Pool retries with exponential backoff: 1s, 2s, 4s, 8s, capped at 30s; retries stop after 5 consecutive network failures and stays `disconnected` until user clicks Reconnect.
  - Version mismatch: show "Daemon protocol version unsupported; upgrade required". No retry.

## Not In Scope

- `list_projects` / `list_sessions` calls (S0036).
- Session attach / event stream (S0037).
- Background reconnect when WebUI tab is hidden (browser may freeze ws; rely on user interaction to retrigger).
- Multi-tab connection coordination (each tab is independent v1).
- Token rotation, refresh, OAuth.

## Acceptance Criteria

- Connection pool creates exactly one client per device id; concurrent route navigations don't spawn duplicates.
- State machine transitions match the table in §Scope; verified by unit tests with a fake `DaemonClient`.
- After handshake, `Device.remoteIdentity` and `lastConnectedAt` are persisted and visible in `/settings/devices/:deviceId`.
- Sidebar status dot reflects live state (use `useSyncExternalStore` against the pool's per-device subscription).
- Error categorization unit tests cover each reason path.
- Manual: start a real daemon (`scorel daemon serve --remote`), add the device in WebUI, verify sidebar dot turns green; stop daemon → red with retry; restart daemon → re-clicking Reconnect transitions to green.
- `pnpm --filter @scorel/webui typecheck && pnpm --filter @scorel/webui test` passes.
- Repo `pnpm typecheck && pnpm test` passes.

## Tests

- Unit tests for connection state machine: every legal transition, illegal transitions are rejected.
- Pool tests: lazy create, reuse, release after timeout, no duplicate clients across rapid navigations.
- Error categorization tests for the four reason buckets.
- Component test for sidebar Device node states.
- Manual real-daemon validation per Acceptance Criteria.

## Affected Paths

- `apps/webui/lib/connection/pool.ts` (new)
- `apps/webui/lib/connection/pool.test.ts` (new)
- `apps/webui/lib/connection/state.ts` (new)
- `apps/webui/lib/connection/state.test.ts` (new)
- `apps/webui/lib/connection/error.ts` (new — categorization)
- `apps/webui/lib/connection/error.test.ts` (new)
- `apps/webui/components/shell/sidebar.tsx` (live status)
- `apps/webui/components/shell/device-status.tsx` (new)
- `apps/webui/app/devices/[deviceId]/page.tsx` (banner + reconnect/disconnect)
- `apps/webui/lib/store/devices.ts` (add `markIdentity`, `markConnectedAt` helpers if needed)
- `docs/ROADMAP.md` (M5 step entry for S0035)

## Risks And Boundaries

- `DaemonClient` API surface for connection events may not currently include all hooks needed; if so, extend `@scorel/client` minimally — keep that change in this spec, and document it in `docs/spec/client.md`.
- Browser WebSocket has limited error introspection. Categorization is best-effort; document the unreliability.
- Backoff constants (1s/2s/4s/8s/30s, 5 attempts) are tuned by feel; expose them as constants for easy adjustment but do not make them user-configurable v1.
- Holding open ws for inactive devices wastes daemon connections. The 60-second release rule is a v1 compromise; revisit if user feedback says it churns too aggressively.
- Multi-tab same-device duplicate connections are accepted v1; daemon already supports multiple clients per session.
