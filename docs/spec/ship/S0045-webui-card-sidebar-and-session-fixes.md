# S0045: WebUI Card-Style Sidebar + Session Page Cleanup + Transport Error Guard

## Goal

Resolve the three blockers surfaced after S0044 ship:

1. **Visual iteration** — collapse the sidebar to a single card-style segment with click-to-toggle project/device rows (no ▸/▾ chevrons), per-session relative-time hints, and selection-by-row highlight.
2. **Session page cleanup** — delete `SessionHeader` and the `Chatbox` card outer shell. Transcript flows directly against the main `bg-bg`.
3. **Transport error guard** — ensure the `WsTransport is not connected` synchronous throw can never escape into React's render or effect path. Stale-token / disconnected scenarios degrade gracefully, no Next.js dev overlay.

Locked decisions live in `self/discussions/2026-05-31-s0045-webui-card-and-fixes-brainstorm.md` §5. Verification context in `self/discussions/2026-05-31-s0044-webui-chatbox-rebuild-verification.md`. Visual reference: user-supplied screenshot (single light-gray sidebar card, no row borders, clicking a project folds its sessions, selected session row gets a darker highlight, sessions show right-aligned relative time hints like `3 周` / `刚刚`).

---

## Scope

### 1. Sidebar — single card segment

`apps/webui/components/shell/sidebar.tsx`:

- Remove the bottom `border-t border-subtle p-3` divider above Settings — the entire `<aside>` is one visual block on `bg-surface`.
- Top row group, devices group, and bottom row group rely on `space-y-*` and section padding for separation. No internal borders.
- Bottom group structure:

```tsx
<div className="px-3 pb-3 pt-2 space-y-1">
  <SettingsLink />
  <DisabledRow icon="☀" label="主题" />
</div>
```

- Top group keeps `+ 新对话` (active when route is `/`) + 3 disabled rows. No structural change beyond removing any leftover borders.

`DeviceTree` row (currently `<Link href={device.url}>`):

- Replace with `<button type="button" onClick={toggleDevice}>` — **no route navigation**. The button toggles the device's collapsed state.
- Keep `aria-expanded={!collapsed}` and `aria-controls`.
- Keep `DeviceStatus` dot on the right.
- `offline` state styling unchanged.
- The `aria-current="page"` logic for active device row is removed; sessions inside drive active state visually via `SessionNode`.
- Drop the leftover `border-l-2 px-2 py-1.5` styling. New base class:

```tsx
className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-medium text-text hover:bg-surface-hover ${
  collapsed ? "" : ""
}`}
```

(no active state on device row; expansion alone is the visual)

`ProjectNode` row (`apps/webui/components/shell/project-node.tsx`):

- Same swap: `<Link href>` → `<button type="button" onClick={toggleProject}>`. **No route navigation.**
- Keep the existing `sessionCount` rendering (right-aligned `text-xs text-faint`); when `sessionCount` is undefined fall back to `Object.keys(project.sessions ?? {}).length` so users still see a count.
- Drop the `border-l-2 border-accent bg-accent-soft` active styling — projects no longer have an "active" concept since clicking doesn't navigate.
- Keep the `onSelect` callback hook, but rename / refocus: it now fires on **expansion** (not collapse), and its purpose is still to lazy-trigger `syncSessions`. Wrap-up: `onSelect` fires whenever the user expands a project that hasn't loaded sessions yet, and only when not offline.

Concrete behaviour:

```tsx
const [collapsed, toggle] = useCollapsed(`project:${deviceId}/${projectSlug}`);
const sessions = sortSessions(project.sessions);
const handleClick = (): void => {
  if (collapsed && !offline) onSelect?.(deviceId, projectSlug);
  toggle();
};
return (
  <li>
    <button
      type="button"
      onClick={handleClick}
      aria-expanded={!collapsed}
      className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm text-text hover:bg-surface-hover"
    >
      <span className="truncate">{project.displayName ?? project.projectSlug}</span>
      {sessionCount !== undefined && (
        <span className="shrink-0 text-xs text-faint">{sessionCount}</span>
      )}
    </button>
    {!collapsed && sessions.length > 0 && (
      <ul className="ml-2 mt-0.5 space-y-0.5">
        {sessions.map((session) => (
          <SessionNode … />
        ))}
      </ul>
    )}
  </li>
);
```

- The `border-l border-subtle pl-2` previously decorating the session sub-list goes away — visual hierarchy is purely indentation (`ml-2`).

`CollapseToggle` (`apps/webui/components/shell/collapse-toggle.tsx`):

- Component no longer rendered anywhere.
- **Delete** the file plus its test (`collapse-toggle.test.tsx`) — toggle logic now lives inline in `ProjectNode` / `DeviceTree`. The hook `useCollapsed` (`lib/store/use-collapsed.ts`) stays exactly as is.

`Sidebar` shell wrapper (`<aside>`) keeps `w-[280px] shrink-0 bg-surface flex flex-col`. No border-r anymore — the warm-paper era left a `border-r border-subtle` on it; current S0044 already dropped it. Verify with grep.

### 2. SessionNode — relative time hint

`apps/webui/components/shell/session-node.tsx`:

- Add `formatRelativeTime(updatedAt: number, now: number): string` (Chinese strings):
  - `now - updatedAt < 60_000` → `刚刚`
  - `< 3_600_000` → `${Math.floor(diff/60_000)} 分钟`
  - `< 86_400_000` → `${Math.floor(diff/3_600_000)} 小时`
  - `< 604_800_000` → `${Math.floor(diff/86_400_000)} 天`
  - `< 2_592_000_000` → `${Math.floor(diff/604_800_000)} 周`
  - `< 31_536_000_000` → `${Math.floor(diff/2_592_000_000)} 个月`
  - else → `${Math.floor(diff/31_536_000_000)} 年`
  - `updatedAt` undefined or NaN → return empty string (caller hides hint).
- Place the helper in `apps/webui/lib/format/relative-time.ts` (new file) so it's testable in isolation and SSR-safe.
- Component:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatRelativeTime } from "../../lib/format/relative-time";
import type { DeviceSessionSummary } from "../../lib/domain/devices";

export function SessionNode({ deviceId, projectSlug, session, isActive }: SessionNodeProps): JSX.Element {
  const href = `/devices/${encodeURIComponent(deviceId)}/projects/${encodeURIComponent(projectSlug)}/sessions/${encodeURIComponent(session.sessionId)}`;
  const label = session.title?.trim() || session.sessionId;
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const hint = now !== null && session.updatedAt
    ? formatRelativeTime(session.updatedAt, now)
    : "";
  return (
    <li>
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        className={`flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-xs hover:bg-surface-hover ${
          isActive ? "bg-surface-hover font-medium text-text" : "text-muted"
        }`}
        title={label}
      >
        <span className="truncate">{label}</span>
        {hint ? <span className="shrink-0 text-faint">{hint}</span> : null}
      </Link>
    </li>
  );
}
```

- SSR phase: `now === null` → no hint rendered. Avoids hydration mismatch from `Date.now()`.
- Cleanup `clearInterval` on unmount.

### 3. Session page cleanup

`apps/webui/app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/page.tsx`:

- Delete the `SessionHeader` function (lines 250-299) and remove its call from `SessionView`.
- `SessionView` outer container changes from `<div className="flex h-full flex-col gap-3 p-6 text-sm text-text">` → `<div className="flex h-full flex-col text-sm text-text">`.
- Move the metadata-loading inline notice (when `error` is set) to render **inside** the new layout, above the chatbox, with no `border` / `bg-surface-raised` card:

```tsx
{error && (
  <p className="px-6 pt-4 text-sm text-status-err">
    Failed to load session metadata: {error}
  </p>
)}
```

- Same for the `!remoteDeviceId` "Connecting to daemon…" notice — replace the dashed-border card with:

```tsx
<p className="flex h-full items-center justify-center text-sm text-muted">
  Connecting to daemon… (waiting for device identity)
</p>
```

- `Chatbox` container outer div changes from:

```tsx
<div className="flex h-[60vh] min-h-[400px] flex-col overflow-hidden rounded-md border border-subtle bg-surface">
```

to:

```tsx
<div className="flex h-full flex-col overflow-hidden">
```

(no card, no border, no fixed height — fills its parent.)

- `ChatboxBody` keeps the inline `snapshot.error` notice but drops the outer `bg-surface-raised`:

```tsx
{snapshot.error && (
  <p className="px-6 py-2 text-xs text-status-err">
    {snapshot.error.reason}: {snapshot.error.message}
  </p>
)}
```

- Composer renders directly under the transcript without any wrapping border.

### 4. Transport error guard

#### 4.1 Map sync throws to rejections

`packages/client/src/index.ts`:

Audit every public method that funnels through `WsTransport.#write` (which throws synchronously when `socket.readyState !== OPEN`). Each public async method must wrap any synchronous part in `try { … } catch (e) { return Promise.reject(toTransportError(e)); }`. Add helper:

```ts
class TransportDisconnectedError extends Error {
  readonly code = "transport_disconnected" as const;
  constructor(message: string) {
    super(message);
    this.name = "TransportDisconnectedError";
  }
}

function toTransportError(cause: unknown): TransportDisconnectedError {
  if (cause instanceof TransportDisconnectedError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return new TransportDisconnectedError(message);
}
```

Concretely:

- `RemoteSessionClient.sendMessage` / `cancel` / `connect` / `resync` / `listSessions` / `listProjects` / `handshake` (or whatever the public surface is — match the existing exported signatures): each one's first line `this.transport.write(...)` is wrapped. If the method already does `await ...`, wrap the entire body. If it returns a Promise built from a deferred object, ensure the deferred is rejected on synchronous throw.

Audit list at implementation time: search `packages/client/src/**` for `transport.write(` and ensure every caller either is already inside a Promise body that catches sync throws, or gets a wrapper.

**Do not change the `WsTransport.#write` semantics** — keeping it sync-throw simplifies internal use. The wrapper sits at the public client boundary.

Add unit tests in `packages/client/src/index.test.ts` (or wherever existing client tests live):

- "sendMessage when transport is closed rejects with code transport_disconnected".
- "cancel when transport is closed rejects with code transport_disconnected".
- "resync when transport is closed rejects with code transport_disconnected".
- The throw is awaited (no synchronous escape).

#### 4.2 Map error in webui

`apps/webui/lib/connection/session.ts`:

- In each existing `catch (cause)` block (inside `start`, `send`, `cancel`), detect `cause?.code === "transport_disconnected"` and pick a stable reason string `"disconnected"` instead of the generic reason. Schema:

```ts
type SessionError =
  | { reason: "resync_failed"; message: string }
  | { reason: "send_failed"; message: string }
  | { reason: "cancel_failed"; message: string }
  | { reason: "disconnected"; message: string };
```

Update the type alias accordingly. Map:

```ts
function classifyError(cause: unknown, fallback: SessionError["reason"]): SessionError {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code = (cause as { code?: string })?.code;
  if (code === "transport_disconnected") {
    return { reason: "disconnected", message };
  }
  return { reason: fallback, message };
}
```

Use in each catch:

```ts
catch (cause) {
  error = classifyError(cause, "resync_failed");
  // ...
}
```

- UI rendering of `snapshot.error` (in session page `ChatboxBody`) prefers a clearer message when reason is `"disconnected"`:

```tsx
{snapshot.error && (
  <p className="px-6 py-2 text-xs text-status-err">
    {snapshot.error.reason === "disconnected"
      ? "连接已断开。检查 daemon token 后刷新页面。"
      : `${snapshot.error.reason}: ${snapshot.error.message}`}
  </p>
)}
```

- `Composer` `errorBanner` follows the same pattern when `cancel_failed` shows up; no UX change.

`apps/webui/lib/sync/sessions.ts`:

- Wrap `client.list_sessions` / `list_projects` calls likewise; map `transport_disconnected` to `setSessionsSyncError(deviceId, projectSlug, "disconnected: " + message)`. The existing best-effort `.catch(() => {})` in `sidebar.tsx` line 117-120 is fine, but the global error map needs the disconnect signal so the project-list page banner can surface it.

`apps/webui/lib/connection/use-connection.ts`:

- When the connection state machine transitions to `error` with `reason === "auth"` (token rejected) keep the existing reconnect cooldown / retry-cap logic. Add a sub-case: if reconnect attempts produce repeated `transport_disconnected` after an `auth` failure, **stop reconnecting** and stay in `error` with a clear message. Surface it via the existing `state.message` field.
- No new connection state machine state; just guarantee no infinite retry loop.

#### 4.3 Global ErrorBoundary

`apps/webui/app/error.tsx` (new file — Next.js App Router error boundary):

```tsx
"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[scorel] unhandled UI error:", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="greeting">出错了</h1>
      <p className="text-md text-muted">
        发生意外错误。已记录到控制台。
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-pill bg-accent px-5 py-2 text-bg hover:bg-accent-hover"
      >
        重新加载
      </button>
    </div>
  );
}
```

Add per-route error boundary at `apps/webui/app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/error.tsx` with the same template scoped to the session route — the global one catches anything escaping route layout.

### 5. Tests

**New**:

- `apps/webui/lib/format/relative-time.test.ts` — every threshold branch; undefined/NaN returns empty.
- `apps/webui/components/shell/session-node.test.tsx` — extend or create:
  - Renders the relative-time hint after mount (use vitest fake timers + `vi.useFakeTimers()`).
  - SSR-style first render (before useEffect) shows no hint.
  - Active class set when `isActive`.
- Extend `apps/webui/components/shell/sidebar.test.tsx`:
  - Click a project row → the row's button fires `onClick` and toggles collapse; **no navigation triggered** (assert `useRouter.push` not called or assert no `<a href>` on project row).
  - Click a session row → still navigates (existing behavior).
  - Confirm device row is now a `<button>` not a `<Link>`.
  - Confirm sidebar has no `border-t` / `border-r` element nested inside.
- Extend `apps/webui/components/shell/project-node.test.tsx`:
  - On expand from collapsed state, fires `onSelect(deviceId, projectSlug)`.
  - On collapse, does NOT fire `onSelect`.
  - When `offline === true`, `onSelect` not fired even on expand.
- New `packages/client/src/transport-error.test.ts` (or extend existing client tests) — see §4.1.
- Extend `apps/webui/lib/connection/session.test.ts` if it exists (else add `session.test.ts`):
  - When `client.sendMessage` rejects with `code: "transport_disconnected"`, snapshot.error.reason is `"disconnected"`.
  - Same for `client.cancel`, `client.resync`.

**Modified**:

- `apps/webui/components/shell/sidebar.test.tsx` — adjust assertions that previously depended on `<Link href={deviceUrl}>` for device row.
- `apps/webui/components/shell/project-node.test.tsx` — same.
- `apps/webui/app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/page.test.tsx` if it exists — drop SessionHeader assertions; assert no `h1` present in chatbox region; assert no `bg-surface` card outer.

**Deleted**:

- `apps/webui/components/shell/collapse-toggle.tsx`
- `apps/webui/components/shell/collapse-toggle.test.tsx`

### 6. Boundary tests

`apps/webui/src/package-boundaries.test.ts`:

- Existing palette ban + `font-display` ban remain.
- Add: scan source files and fail if `<CollapseToggle` JSX or `from ".*collapse-toggle"` import survives. (Cheap regex over `apps/webui/{app,components}/**/*.tsx` excluding test files.)

---

## Not In Scope

- Real keyboard shortcuts ⌘1..9 to jump between sessions.
- Truncating the session list with a "展开显示" button after N items.
- Dark mode implementation.
- Cmd+B full sidebar collapse to 56px.
- Composer model picker real switching.
- Daemon protocol changes (all fixes are local to client + webui).
- Project overview page redesign — the route is preserved (typed URL still loads it) but no longer reachable from the sidebar.

---

## Acceptance Criteria

1. Sidebar has no internal borders / dividers anywhere; visual hierarchy comes from `space-y-*` spacing and hover/active background changes only.
2. Project / Device rows are `<button>` elements that toggle collapse on click. No route navigation. Tested in `sidebar.test.tsx`.
3. Session row stays the only entry to a session. Tested.
4. `<CollapseToggle>` component and its test file are deleted; no source imports it.
5. Project row shows `sessionCount` (or fallback derived count) right-aligned `text-xs text-faint`.
6. Session row shows `formatRelativeTime` hint right-aligned `text-xs text-faint`. Hint is empty when `session.updatedAt` is missing/invalid.
7. Hint refreshes once per minute and clears its interval on unmount. Verified by `session-node.test.tsx`.
8. SessionHeader function and call site removed. No `<h1>` rendered in the session route layout above the transcript.
9. Chatbox container does not use `h-[60vh]`, `min-h-[400px]`, `rounded-md`, `border-subtle`, or `bg-surface` on its outermost wrapper. Transcript and Composer flow directly inside `flex h-full flex-col` against the main `bg-bg`.
10. `SessionView` outer container drops the `gap-3 p-6` padding wrapper; inline notices use `px-6` for indentation only.
11. `packages/client/src/index.ts` public methods (`sendMessage`, `cancel`, `connect`, `resync`, `listSessions`, `listProjects`, `handshake` and any other public path that hits `transport.write`) catch synchronous throws and return rejected promises with `code: "transport_disconnected"`.
12. New `TransportDisconnectedError` class is exported from `@scorel/client` so consumers can `instanceof` check it.
13. `apps/webui/lib/connection/session.ts` `SessionError` type now includes `"disconnected"` reason. All catch blocks classify via `classifyError`.
14. `ChatboxBody` renders the friendly "连接已断开。检查 daemon token 后刷新页面。" message when `snapshot.error.reason === "disconnected"`.
15. `apps/webui/app/error.tsx` and `apps/webui/app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/error.tsx` exist and render the greeting + reload button template.
16. `pnpm --filter @scorel/app-webui typecheck && pnpm --filter @scorel/app-webui test && pnpm --filter @scorel/app-webui build` all green.
17. Repo-level `pnpm typecheck && pnpm test` green.
18. Manual e2e by user (out of opus subagent scope; record results in a follow-up verification doc):
   - Stale-token reproducer: edit `~/.scorel/daemon.json` to replace the token with garbage, refresh `/`. **Expect**: no Next.js dev overlay, no red modal. Sidebar shows the device offline; opening a cached session shows the friendly disconnected message inline.
   - Card sidebar: matches the user-supplied screenshot (single-block light gray, no internal borders, click project to fold sessions, hover row highlights, selected session row highlight slightly darker).
   - Relative time hint visible on every session row with `updatedAt`.
   - Click a project row: sessions fold/unfold; URL does not change.
   - Click a session row: navigates to `/devices/.../sessions/...`.
   - Session route shows transcript flush against bg, composer at bottom pill, no header.
   - CLI `scorel attach` to the same session keeps streaming in sync.

---

## Affected Paths

- `apps/webui/components/shell/sidebar.tsx`
- `apps/webui/components/shell/project-node.tsx`
- `apps/webui/components/shell/project-node.test.tsx`
- `apps/webui/components/shell/session-node.tsx`
- `apps/webui/components/shell/session-node.test.tsx` *(new or modified)*
- `apps/webui/components/shell/collapse-toggle.tsx` — **deleted**
- `apps/webui/components/shell/collapse-toggle.test.tsx` — **deleted**
- `apps/webui/components/shell/sidebar.test.tsx`
- `apps/webui/lib/format/relative-time.ts` — **new**
- `apps/webui/lib/format/relative-time.test.ts` — **new**
- `apps/webui/lib/connection/session.ts`
- `apps/webui/lib/connection/use-connection.ts`
- `apps/webui/lib/sync/sessions.ts`
- `apps/webui/lib/connection/session.test.ts` (extended, or created if absent)
- `apps/webui/app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/page.tsx`
- `apps/webui/app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/error.tsx` — **new**
- `apps/webui/app/error.tsx` — **new**
- `apps/webui/src/package-boundaries.test.ts`
- `packages/client/src/index.ts`
- `packages/client/src/index.test.ts` (or `transport-error.test.ts` — existing test file pattern)
- `packages/client/src/index.ts` exports updated (export `TransportDisconnectedError`)
- `docs/ROADMAP.md` — append M5.7.2 entry + S0045 row, mark Done after ship
- `apps/webui/README.md` (if it explains sidebar interactions, update)

---

## Risks And Boundaries

- **Project overview page accessibility**: removing the project row link cuts the only sidebar path to `/devices/:id/projects/:slug`. The route stays reachable via direct URL. If users complain we add a small "open project" sub-row in a follow-up spec.
- **`onSelect` semantics flip**: previously fired on every link click; now only fires on expand. Make sure `syncSessions` is still triggered the first time a project is opened. Mitigation: when `expanded === true` from initial state and `sessions === undefined`, fire `onSelect` once on mount.
- **setInterval per session row**: 1 timer per visible row. Typical < 100, fine. If we ever render hundreds of sessions, replace with a single global tick + context.
- **Hydration mismatch**: `Date.now()` differs between server render and client render. Solved by `useState<number | null>(null)` + `useEffect` initial set; first paint shows no hint, subsequent paints update.
- **Transport-error wrapper**: wrapping every public method must not change the existing rejection paths (most rejections come from the daemon over the wire and shouldn't get reclassified as `transport_disconnected`). The check is strict: only synchronous throws from `transport.write` get the special code. Daemon-side `error` responses keep their existing reason.
- **Per-route error boundaries**: Next 14 App Router has subtle hydration differences between `app/error.tsx` (segment scope) and `app/global-error.tsx` (full root). We use segment scope; if the layout itself throws, the existing fallback shows.
- **Deleting `CollapseToggle`**: no other consumer should reference it; the boundary test catches stragglers.
- **Single-PR scope**: S0045 touches sidebar + session page + client error mapping + new tests. Keep one commit `S0045: feat: card-style sidebar + session cleanup + transport guard`.
- **Sunk cost from S0044**: this iteration is the second pass on the same UI in 24 hours. Accept it; the structure (tokens, three-segment shell, pill composer, bubble shape) all survive — only sub-component shapes change.
