# S0034: WebUI Device Model And Settings CRUD

## Goal

Lock the WebUI domain model (`Device`, `DeviceProject`, `DeviceSessionSummary`), introduce the single browser-storage abstraction (`BrowserStore`, `localStorage` v1), and ship the Settings page so users can add / edit / delete a Device. No daemon connection yet — Settings is purely local persistence.

## Scope

- Domain types in `apps/webui/lib/domain/devices.ts`:
  ```ts
  type Device = {
    id: string;                  // ulid generated client-side
    name: string;
    link: string;                // normalized wss://host[:port][/path] | ws://...
    token: string;               // v1 cleartext
    createdAt: number;
    lastConnectedAt?: number;
    remoteIdentity?: { deviceId: string; deviceDisplayName?: string };
    projects?: DeviceProject[];
    projectsFetchedAt?: number;
  };
  type DeviceProject = {
    projectSlug: string;
    displayName?: string;
    workDirHint?: string;
    sessionCount?: number;
    lastSeenAt?: number;
    sessions?: Record<string, DeviceSessionSummary>;
    sessionsFetchedAt?: number;
  };
  type DeviceSessionSummary = {
    sessionId: string;
    title?: string;
    model?: string;
    updatedAt?: number;
    currentSeq?: number;
  };
  ```
- BrowserStore abstraction in `apps/webui/lib/store/browser-store.ts`:
  - Single namespace prefix: `scorel:webui:v1:`.
  - API: `get<T>(key): T | undefined`, `set<T>(key, value): void`, `remove(key): void`, `subscribe(key, listener): unsubscribe` (uses `storage` events for cross-tab + an in-process pub/sub).
  - Quota handling: catch `QuotaExceededError`; expose `onQuotaExceeded` hook (used by future attach-cache evictor; v1 just logs and rethrows).
  - SSR safety: `BrowserStore` constructor takes `storage: Storage | null`. On the server (Next.js render), pass `null` and all reads return `undefined`, all writes are no-ops. Hooks integrate with `useSyncExternalStore`.
- Devices store in `apps/webui/lib/store/devices.ts`:
  - Reads/writes `scorel:webui:v1:devices` (a JSON-encoded `Device[]`).
  - Methods: `list()`, `get(id)`, `create(input)`, `update(id, patch)`, `remove(id)`. All synchronous on top of BrowserStore.
  - `create` generates ulid via `crypto.randomUUID` (acceptable v1; ulid lib only if string format matters).
  - Validates and normalizes Link before persist (see below).
- Link normalization in `apps/webui/lib/domain/link.ts`:
  - Accept input: `wss://host[:port][/path]` or `ws://host[:port][/path]`. Reject anything else with a clear error string.
  - Trim whitespace.
  - Lowercase scheme and host.
  - Strip trailing `/`.
  - Reject empty token (separate validator on the form).
- Settings UI in `apps/webui/app/settings/page.tsx` and `apps/webui/app/settings/devices/[deviceId]/page.tsx`:
  - List page: table/list of devices, "Add Device" button, edit + delete actions.
  - Add/edit form fields: Name (required, 1–64 chars), Link (required, validated by `link.ts`), Token (required, 1–4096 chars; rendered as password input).
  - Form errors shown inline; submit disabled while invalid.
  - Delete confirms via standard browser `confirm()`; v1 acceptable.
- Sidebar wiring in `apps/webui/components/shell/sidebar.tsx`:
  - Read devices via the devices store hook.
  - Render Device nodes (just name + faint "not connected" badge — connection happens in S0035).
  - Each Device node links to `/devices/:deviceId`.
- Empty-state copy: when no devices exist, root page shows "Add a device in Settings to get started" with a button linking to `/settings`.

## Not In Scope

- DaemonClient instantiation, handshake, project/session listing (S0035, S0036).
- Connection state indicators beyond "configured but not connected" placeholder.
- Token encryption / Web Crypto / IndexedDB.
- Multi-tab realtime sync of device list (basic `storage` event subscription is included; no conflict resolution beyond last-write-wins).
- Import / export devices.
- Dark mode / theming.

## Acceptance Criteria

- Domain types match §Scope exactly; exported from `lib/domain/devices.ts`.
- BrowserStore is the only module that touches `localStorage` directly. Enforced by the package-boundaries test from S0033 extended to forbid `localStorage` references outside `lib/store/`.
- Devices store round-trips: create → list returns the device; update mutates fields; remove deletes. All reflected in `localStorage` under `scorel:webui:v1:devices`.
- Link validator rejects: `http://...`, `https://...`, `wss:`/`wss:///`, empty, plain hostname. Accepts `wss://host`, `wss://host:9876`, `ws://localhost:8765`, `wss://host/path/`.
- Settings list page renders all devices; add form creates a new device; edit form updates; delete removes.
- Sidebar shows configured devices with "not connected" badge; clicking navigates to `/devices/:deviceId`.
- Root empty state appears when zero devices configured.
- `pnpm --filter @scorel/webui typecheck && pnpm --filter @scorel/webui test` passes.
- Manual: open `/settings`, add a device with link `wss://localhost:9876` and token `abc`, verify list shows it; refresh page, device persists; edit name; delete; confirm sidebar reflects changes live.

## Tests

- Unit tests for `lib/domain/link.ts` covering accept/reject cases.
- Unit tests for `lib/store/devices.ts` using `vitest` with a fake `Storage` implementation.
- Unit test extending `package-boundaries.test.ts` to assert `localStorage` only appears under `lib/store/`.
- Component test (Vitest + jsdom) for settings list and add form: rendering, form validation error states, submit dispatch.
- Run `pnpm --filter @scorel/webui typecheck && pnpm --filter @scorel/webui test`.
- Run repo-level `pnpm typecheck && pnpm test`.

## Affected Paths

- `apps/webui/lib/domain/devices.ts` (new)
- `apps/webui/lib/domain/link.ts` (new)
- `apps/webui/lib/domain/link.test.ts` (new)
- `apps/webui/lib/store/browser-store.ts` (new)
- `apps/webui/lib/store/browser-store.test.ts` (new)
- `apps/webui/lib/store/devices.ts` (new)
- `apps/webui/lib/store/devices.test.ts` (new)
- `apps/webui/app/settings/page.tsx`
- `apps/webui/app/settings/devices/[deviceId]/page.tsx`
- `apps/webui/components/settings/device-list.tsx` (new)
- `apps/webui/components/settings/device-form.tsx` (new)
- `apps/webui/components/shell/sidebar.tsx`
- `apps/webui/app/page.tsx` (empty-state with link to settings)
- `apps/webui/src/package-boundaries.test.ts` (extend)
- `docs/ROADMAP.md` (M5 step entry for S0034)

## Risks And Boundaries

- **Token cleartext**: documented v1 trade-off; spec must not promise encryption later in this milestone. README/UX should warn users not to share screenshots of Settings.
- **`crypto.randomUUID`** is available in modern browsers; pin to it (no polyfill).
- **SSR**: Settings forms are client components (`"use client"`); the rest of the shell stays server-rendered where possible.
- **Cross-tab races**: last-write-wins via `storage` event is acceptable v1; document the gap.
- **Form library**: keep it native (`<form>` + `useState`). No react-hook-form / zod runtime in this spec; if S0035+ need stronger validation, reassess then.
- **Quota**: with only the Devices array v1 we are far below 5MB; explicit quota handling lives in attach-cache work (S0037+).
