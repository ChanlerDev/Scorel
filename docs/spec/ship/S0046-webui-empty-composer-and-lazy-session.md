# S0046: WebUI Empty-State Composer + Lazy Session Creation

## Goal

Convert the populated empty-state surface (`/`, `/devices/:id`, `/devices/:id/projects/:slug`) into a Codex-/Chatbox-style "central composer" landing: H1 prompt + large pill composer + project picker + mode/branch placeholders. Sidebar `+ 新对话` and the project-page `New Chat` button no longer create a session immediately — they navigate to the empty composer carrying device/project as query params. Session creation is deferred to the user's first `send`, eliminating empty-session sprawl.

Locked decisions: `self/discussions/2026-05-31-s0046-webui-empty-composer-brainstorm.md` §5. Visual reference: user-supplied screenshot (centered H1 "我们应该在 Scorel 中构建什么?", pill composer with `随心输入` placeholder, three pickers below: project / 本地模式 / main).

---

## Scope

### 1. New empty-state composer component

`apps/webui/components/chatbox/empty-composer.tsx` — **new client component**:

```tsx
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  getConnectionPool,
  getDevicesStoreInstance,
} from "../../lib/connection/use-connection";
import { createSessionForProject } from "../../lib/sync/session-create";
import { useDevices } from "../../lib/store/use-devices";
import {
  readLastActiveProject,
  writeLastActiveProject,
} from "../../lib/store/last-active-project";
import { Composer } from "./composer";

export type EmptyComposerProps = {
  /** Defaults sourced from the route segment (when on
   * `/devices/:id/projects/:slug`). The picker can override; URL `?device=`,
   * `?project=` query string takes precedence over both. */
  routeDeviceId?: string;
  routeProjectSlug?: string;
};

export function EmptyComposer({
  routeDeviceId,
  routeProjectSlug,
}: EmptyComposerProps): JSX.Element {
  const router = useRouter();
  const search = useSearchParams();
  const { devices } = useDevices();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Resolve effective deviceId.
  const deviceId = useMemo(() => {
    const fromQuery = search?.get("device") ?? undefined;
    return fromQuery || routeDeviceId || devices[0]?.id;
  }, [search, routeDeviceId, devices]);
  const device = devices.find((d) => d.id === deviceId);
  const projects = device?.projects ?? [];

  // Resolve effective projectSlug.
  const projectSlug = useMemo(() => {
    const fromQuery = search?.get("project") ?? undefined;
    if (fromQuery) return fromQuery;
    if (routeProjectSlug) return routeProjectSlug;
    const last = readLastActiveProject(deviceId);
    if (last && projects.find((p) => p.projectSlug === last)) return last;
    return projects[0]?.projectSlug;
  }, [search, routeProjectSlug, deviceId, projects]);

  useEffect(() => {
    if (deviceId && projectSlug) writeLastActiveProject(deviceId, projectSlug);
  }, [deviceId, projectSlug]);

  const handleProjectChange = (slug: string): void => {
    const params = new URLSearchParams(search?.toString() ?? "");
    params.set("project", slug);
    if (deviceId) params.set("device", deviceId);
    router.replace(`/?${params.toString()}`);
  };

  const handleSend = async (content: string): Promise<void> => {
    setError(null);
    if (!deviceId || !projectSlug) {
      setError("先选择设备和项目");
      return;
    }
    const pool = getConnectionPool();
    const client = pool.peekClient(deviceId);
    if (!client) {
      setError("设备未连接,先去 Settings 检查");
      return;
    }
    setBusy(true);
    try {
      const { sessionId } = await createSessionForProject({
        client,
        store: getDevicesStoreInstance(),
        deviceId,
        projectSlug,
      });
      sessionStorage.setItem(`scorel.pending-prompt:${sessionId}`, content);
      const target = `/devices/${encodeURIComponent(deviceId)}/projects/${encodeURIComponent(projectSlug)}/sessions/${encodeURIComponent(sessionId)}`;
      router.push(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (devices.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="greeting">欢迎使用 Scorel</h1>
        <p className="text-md text-muted">先添加一个设备开始</p>
        <Link
          href="/settings"
          className="rounded-pill bg-accent px-5 py-2 text-bg hover:bg-accent-hover"
        >
          打开 Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="w-full max-w-3xl space-y-6">
        <h1 className="greeting text-center">
          我们应该在 Scorel 中构建什么?
        </h1>
        <Composer
          onSend={handleSend}
          inFlight={false}
          placeholder="随心输入"
          disabled={busy || !deviceId || !projectSlug}
          errorBanner={error ?? undefined}
        />
        <PickerRow
          projects={projects}
          activeSlug={projectSlug}
          onProjectChange={handleProjectChange}
        />
      </div>
    </div>
  );
}

function PickerRow({
  projects,
  activeSlug,
  onProjectChange,
}: {
  projects: { projectSlug: string; displayName?: string }[];
  activeSlug: string | undefined;
  onProjectChange: (slug: string) => void;
}): JSX.Element {
  const single = projects.length <= 1;
  return (
    <div className="flex items-center justify-center gap-3 text-sm">
      <label className="flex items-center gap-1 text-muted">
        <span aria-hidden>📁</span>
        <select
          value={activeSlug ?? ""}
          onChange={(e) => onProjectChange(e.target.value)}
          disabled={single}
          aria-label="选择项目"
          className="rounded-sm bg-transparent text-text outline-none focus-visible:outline-2 focus-visible:outline-text disabled:cursor-default"
        >
          {projects.map((p) => (
            <option key={p.projectSlug} value={p.projectSlug}>
              {p.displayName ?? p.projectSlug}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled className="btn-disabled flex items-center gap-1 text-muted">
        <span aria-hidden>💻</span>
        <span>本地模式</span>
        <span aria-hidden>▾</span>
      </button>
      <button type="button" disabled className="btn-disabled flex items-center gap-1 text-muted">
        <span aria-hidden>⎇</span>
        <span>main</span>
        <span aria-hidden>▾</span>
      </button>
    </div>
  );
}
```

Key decisions encoded above:

- Native `<select>` for project picker (no Base UI Combobox in this spec).
- Empty-state inherits from URL query > route segment > localStorage > first available.
- `disabled` on Composer when `!deviceId || !projectSlug` so `send` button stays inert.

### 2. Composer prop change

`apps/webui/components/chatbox/composer.tsx`:

- Add `placeholder?: string` already exists. No change needed.
- `errorBanner` already supported.
- `inFlight` semantics: `EmptyComposer` always passes `false` since the in-flight state is owned post-create by the session page. The "creating session" feedback shows via `disabled` + the `errorBanner` if it fails.

Optional polish (within this spec): when `disabled` is true and the user attempts to type, no UX change required; the textarea simply doesn't accept focus.

### 3. Page integrations

`apps/webui/app/page.tsx`:

```tsx
"use client";

import { EmptyComposer } from "../components/chatbox/empty-composer";

export default function HomePage(): JSX.Element {
  return <EmptyComposer />;
}
```

(No props — `EmptyComposer` figures out everything from `useSearchParams` + `useDevices`.)

`apps/webui/app/devices/[deviceId]/page.tsx`:

- Currently lists projects. Replace **content above the project list** so the page renders an `EmptyComposer` (with `routeDeviceId={params.deviceId}`) and below it the project list / sessions index.
- Layout: `flex h-full flex-col` — top half centered EmptyComposer (via flex-grow), bottom half scrollable project listing — **simplification**: keep the existing project listing intact, but render `EmptyComposer` ABOVE only when route has no further segments. Since this page already shows projects, push the project listing into a smaller helper section beneath:

Actually, simpler path: for S0046 we **only convert `/`** to use EmptyComposer, since the `/devices/:id` and `/devices/:id/projects/:slug` pages already serve as project / session listings. The user's screenshot shows the empty composer at `/`. Inheriting `+ 新对话` route via query string is sufficient.

**Revised**: only `app/page.tsx` changes. `app/devices/[deviceId]/page.tsx` and `app/devices/[deviceId]/projects/[projectSlug]/page.tsx` stay as-is.

`+ 新对话` from any route navigates to `/?device=…&project=…` carrying inherited context. The user lands on `/` with the EmptyComposer pre-populated.

### 4. NewChatButton — rewrite as navigation

`apps/webui/components/shell/new-chat-button.tsx`:

Replace the entire `handleClick` body. New behavior:

```ts
const router = useRouter();
const handleClick = (): void => {
  const params = new URLSearchParams();
  if (deviceId) params.set("device", deviceId);
  if (projectSlug) params.set("project", projectSlug);
  router.push(params.toString() ? `/?${params.toString()}` : "/");
};
```

- Drop `createSession` prop (and the imported helper / pool / store from this file).
- Drop `creating` state, `error` state, the error banner.
- Drop the `tooltip = "Select a project first"` — the button is always enabled; missing context falls back gracefully (just push `/`).
- `disabled` only when there are zero devices configured (in which case sidebar shouldn't render it anyway, but defend).
- Test seam `createSession` prop removed; tests must adapt (assert router.push call).

`variant="page"` (used inside `apps/webui/app/devices/[deviceId]/projects/[projectSlug]/page.tsx`) — same rewrite. The button still navigates to `/?device=…&project=…`.

### 5. Session-page pending-prompt consumption

`apps/webui/app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/page.tsx`:

In `Chatbox` component, after the controller is created and `snapshot.loading === false`, consume any pending prompt **once**:

```ts
const consumedRef = useRef(false);

useEffect(() => {
  if (consumedRef.current) return;
  if (snapshot.loading) return;
  if (!controllerRef.current) return;
  if (typeof window === "undefined") return;
  const key = `scorel.pending-prompt:${sessionId}`;
  const pending = window.sessionStorage.getItem(key);
  if (!pending) return;
  consumedRef.current = true;
  window.sessionStorage.removeItem(key);
  void controllerRef.current.send(pending).catch(() => {
    // Error surfaces via snapshot.error; nothing else to do here.
  });
}, [snapshot.loading, sessionId]);
```

- `consumedRef` ensures one-shot send even on subsequent renders.
- `snapshot.loading === false` proxies "controller fully ready" — same gate the existing UI uses to hide the loading spinner.
- Failure rendering already covered by existing `snapshot.error` UI.

### 6. localStorage helpers

`apps/webui/lib/store/last-active-project.ts` — **new**:

```ts
const KEY = "scorel.ui.last-active-project";

type Map = Record<string, string>; // deviceId -> projectSlug

function read(): Map {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Map;
  } catch {
    return {};
  }
}

function write(next: Map): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(next));
}

export function readLastActiveProject(deviceId: string | undefined): string | undefined {
  if (!deviceId) return undefined;
  return read()[deviceId];
}

export function writeLastActiveProject(deviceId: string, projectSlug: string): void {
  const map = read();
  map[deviceId] = projectSlug;
  write(map);
}
```

### 7. Tests

**New**:

- `apps/webui/lib/store/last-active-project.test.ts` — read/write round-trip, JSON corruption fallback.
- `apps/webui/components/chatbox/empty-composer.test.tsx`:
  - Renders H1, Composer, picker.
  - Picker switching project triggers `router.replace` with `?device=&project=`.
  - `handleSend` calls `createSessionForProject`, writes `sessionStorage`, calls `router.push` to session route.
  - `handleSend` failure shows `errorBanner` and does not write sessionStorage.
  - When `devices.length === 0` shows "先添加设备" CTA.
- `apps/webui/components/shell/new-chat-button.test.tsx` — adapt:
  - click → `router.push("/?device=…&project=…")` when both context fields are present.
  - click → `router.push("/")` when nothing is in context.
  - **Removed**: assertions on `createSession` calls.
- Session page pending-prompt test (extend or new):
  - Mock controller; pre-write `sessionStorage["scorel.pending-prompt:<id>"]`; render session page; expect controller.send called once with the pending text; expect sessionStorage entry cleared after send.
  - Re-render same component; expect controller.send NOT called again.

**Modified**:

- `apps/webui/components/shell/sidebar.test.tsx` — adapt assertions tied to the old NewChatButton API; assert `+ 新对话` is a button that navigates without creating sessions.
- `apps/webui/lib/sync/session-create.test.ts` (if exists) — no behavior change; helper still used by `EmptyComposer.handleSend`.

**Boundary**:

- `apps/webui/src/package-boundaries.test.ts` — add a check: `apps/webui/components/shell/new-chat-button.tsx` must not import `lib/sync/session-create` (ensures the rewrite removes the old dependency).

### 8. Empty composer placeholder text

design.md mandates "Message Scorel…" for chatbox composer; for empty-state we use **"随心输入"** per the screenshot. Pass via `placeholder` prop. Both placeholders use `text-faint`.

### 9. Picker styling

- `<select>` strips native styling: `appearance-none` if needed (Tailwind 4 doesn't auto-strip). Add a small `<span>▾</span>` next to label OR rely on native chevron.
- Pickers row width: `mx-auto`, gap 12px, font 14px text-muted.
- Hover on the `<select>` only (since others are disabled): `hover:text-text`.

---

## Not In Scope

- Project hover `...` menu / ✏ icon button on sidebar project rows.
- Bottom decorative cards (连接消息传送 / 邮件 / 文件).
- "完全访问权限" orange badge.
- Real local/remote mode switching, real branch picker, real model picker — all stay disabled placeholders.
- Daemon-side firstPrompt (one-step create + send) protocol.
- Multi-device picker on the empty surface (URL `?device=` + sidebar device click is enough).
- Auto-connect on landing — existing `useConnection` flow unchanged.
- Empty composer on `/devices/:id` and `/devices/:id/projects/:slug` pages — only `/` converts in this spec.

---

## Acceptance Criteria

1. `/` with at least one device renders centered H1 "我们应该在 Scorel 中构建什么?" + pill Composer (placeholder "随心输入") + picker row (project select, mode placeholder, branch placeholder).
2. `/` with zero devices preserves the existing "先添加设备" + Settings CTA.
3. Project `<select>` lists current device's projects; `value` resolves URL `?project=` > `routeProjectSlug` > localStorage > first available.
4. Switching project via `<select>` calls `router.replace` with `?device=&project=` and writes localStorage `scorel.ui.last-active-project`.
5. `<EmptyComposer>` `handleSend` calls `createSessionForProject`, on success writes `sessionStorage["scorel.pending-prompt:<id>"]`, then `router.push` to session route.
6. `<EmptyComposer>` `handleSend` failure surfaces an error message via `errorBanner` and does NOT write sessionStorage.
7. Sidebar `+ 新对话` button (variant `sidebar`) navigates to `/?device=…&project=…` (or `/`), never calls `createSession`.
8. Project-page `New Chat` button (variant `page`) does the same.
9. `new-chat-button.tsx` no longer imports `lib/sync/session-create`. Boundary test enforces.
10. Session page mounts → after `snapshot.loading === false` → reads `sessionStorage["scorel.pending-prompt:<sessionId>"]` → calls `controller.send(pending)` exactly once → removes the storage key.
11. Mode + branch buttons are `<button disabled className="btn-disabled">`. No hover reaction. `cursor-not-allowed`.
12. `pnpm --filter @scorel/app-webui typecheck && test && build` green.
13. Repo `pnpm typecheck && pnpm test` green.
14. Manual e2e (out of opus scope, log in follow-up verification doc):
    - Land at `/`, type prompt, click send → routes to `/devices/.../sessions/<new>`, user bubble appears, assistant streams.
    - Type prompt, click sidebar `+ 新对话` mid-typing → routes to `/` clearing the in-flight state. **No empty session in daemon `list_sessions`**.
    - Switch project via picker → URL updates, localStorage persists.
    - From session page click sidebar `+ 新对话` → routes to `/?device=&project=` carrying current context.
    - Verify daemon JSONL: a session is only created on the first send.

---

## Affected Paths

- `apps/webui/app/page.tsx`
- `apps/webui/components/chatbox/empty-composer.tsx` — **new**
- `apps/webui/components/chatbox/empty-composer.test.tsx` — **new**
- `apps/webui/components/shell/new-chat-button.tsx`
- `apps/webui/components/shell/new-chat-button.test.tsx`
- `apps/webui/components/shell/sidebar.test.tsx` (adjust)
- `apps/webui/lib/store/last-active-project.ts` — **new**
- `apps/webui/lib/store/last-active-project.test.ts` — **new**
- `apps/webui/app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/page.tsx` (pending-prompt consumption)
- `apps/webui/app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/page.test.tsx` (or new pending-prompt test file)
- `apps/webui/src/package-boundaries.test.ts` (forbid `session-create` import in `new-chat-button.tsx`)
- `docs/ROADMAP.md` — append M5.9 + S0046 row

---

## Risks And Boundaries

- **Pending-prompt race**: if `controller.send` is awaited before `start()` resolves the resync, send rejects. Gate strictly on `snapshot.loading === false`.
- **sessionStorage leak**: if user creates a session but closes the tab before navigation completes, the storage entry remains. Cleanup is best-effort; on a future visit to the session route the entry is consumed; otherwise it idles. Acceptable — sessionStorage clears on tab close anyway.
- **Half-failed create+send**: if `createSession` succeeds but `router.push` is interrupted (rare), the session exists empty. User can navigate to it manually. Not a new failure mode.
- **Multiple tabs**: each tab has independent sessionStorage. A `+ 新对话` in one tab doesn't affect another. URL query is the only cross-tab hint, which is fine.
- **Default project mismatch**: localStorage may point to a project no longer on the device. Fallback to first available avoids a stuck `<select>`.
- **`<select>` styling**: Native looks slightly off-brand on Safari/Chrome. Acceptable; if user complaints arise, swap to a Base UI Combobox in a follow-up spec.
- **Keep router state lean**: `router.replace` for picker change avoids polluting browser back history; `router.push` for send is intentional (back navigates back to empty composer).
- **Single-PR scope**: Touches `/`, NewChatButton, session page, two new lib helpers, two new components. One commit `S0046: feat: empty-state composer + lazy session creation`.
