# S0036: WebUI Project And Session Sync

## Goal

After a device is connected, populate its project list via `list_projects` and (lazily) its session list per project via `list_sessions({ projectSlug })`. Render the sidebar tree (Device → Project → Session) from the persisted `Device.projects` snapshot, with offline-cache fallback.

## Scope

- After handshake (state machine reaches `connected`), `lib/connection/sync.ts` calls `client.listProjects()` and writes the result into `Device.projects` via the devices store. Stale `projects` from a prior connection are replaced wholesale (overwrite snapshot, not merge).
- Sidebar Device node renders `Device.projects` if present, else "(no projects yet)" placeholder. Connected and `projects` empty → render same placeholder; offline → render last persisted `projects` with a faint "offline" tint.
- Selecting a project (clicking Project node, or navigating to `/devices/:deviceId/projects/:projectSlug`) triggers `client.listSessions({ projectSlug, limit: 200 })`. Result writes to `DeviceProject.sessions` (keyed by `sessionId`) and updates `sessionsFetchedAt`.
- Sessions list renders newest first by `updatedAt`. If `sessions` already cached, render immediately and refresh in background; replace on refresh result.
- New project navigation uses Next.js `Link` and updates URL state via App Router. Sidebar reflects the active route.
- Sync helpers in `apps/webui/lib/sync/projects.ts` and `apps/webui/lib/sync/sessions.ts`:
  - `syncProjects(deviceId)`: client.listProjects → store.update.
  - `syncSessions(deviceId, projectSlug)`: client.listSessions → store.update.
  - Both deduplicate concurrent calls per (deviceId, projectSlug).
- Empty / error paths:
  - listProjects fails: keep existing `Device.projects` cache; show toast/banner "Failed to load projects" with retry button.
  - listSessions fails: same pattern at the project level.
- URL params: `projectSlug` may contain unreserved characters per S0031 (no `/`, no encoding tricks needed). Use `decodeURIComponent` defensively when reading from `params` — but daemon-emitted slugs already pass through Tailwind/URL path safely.

## Not In Scope

- Chatbox (S0037) — selecting a session shows an empty chatbox shell with header info only here.
- attach-cache reads (those land in S0037 alongside dual-seq resync).
- Cross-device project aggregation / search.
- Session creation (`New Chat`) — lives in S0039.
- Real-time push of new sessions / projects (no server-side push API yet; v1 polls on user navigation).

## Acceptance Criteria

- After connecting a device with three projects, sidebar shows three Project nodes under that Device with daemon-supplied `displayName`.
- Clicking a Project node lists its sessions; sessions persisted to `DeviceProject.sessions` so re-navigating after reload shows the cached list before the refresh fetch resolves.
- Disconnecting the device transitions sidebar to faint "offline" tint but keeps the last project/session structure visible until the user removes the device.
- Project list refresh on every successful (re)connect (overwrite); session list refresh on every project navigation; both deduplicated under concurrent triggers.
- listProjects / listSessions errors do not erase cache; they show a non-blocking error banner.
- `pnpm --filter @scorel/webui typecheck && pnpm --filter @scorel/webui test` passes.
- Repo `pnpm typecheck && pnpm test` passes.
- Manual: with two real daemons (different `--cwd`), each registered as a Device, sidebar shows both Devices with their respective projects.

## Tests

- Unit tests for `syncProjects` / `syncSessions` happy path, error preservation, concurrent dedupe.
- Component tests for sidebar Project / Session nodes (rendered from a fake store).
- Integration test using a stub `DaemonClient` returning canned `listProjects` / `listSessions` results, asserting store mutation and URL navigation behavior.
- Manual: as above.

## Affected Paths

- `apps/webui/lib/sync/projects.ts` (new)
- `apps/webui/lib/sync/projects.test.ts` (new)
- `apps/webui/lib/sync/sessions.ts` (new)
- `apps/webui/lib/sync/sessions.test.ts` (new)
- `apps/webui/lib/store/devices.ts` (add `setProjects`, `setProjectSessions` helpers)
- `apps/webui/components/shell/sidebar.tsx` (project + session nodes)
- `apps/webui/components/shell/project-node.tsx` (new)
- `apps/webui/components/shell/session-node.tsx` (new)
- `apps/webui/app/devices/[deviceId]/page.tsx` (kick off `syncProjects` on mount via `"use client"` effect)
- `apps/webui/app/devices/[deviceId]/projects/[projectSlug]/page.tsx` (kick off `syncSessions`)
- `apps/webui/app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/page.tsx` (placeholder chatbox header; full chatbox in S0037)
- `docs/ROADMAP.md` (M5 step entry for S0036)

## Risks And Boundaries

- `list_sessions` returns up to 200 entries v1 (per S0032 default). For projects with thousands of sessions, the sidebar truncates silently. Acceptable v1; flag as a known limit.
- Cache eviction: device removal must clean up its `projects` entries (handled in S0034 store helpers; verify here).
- Navigating to a session under a project not yet synced is allowed (URL deep-linking); the page still triggers `syncSessions` even if the session isn't in cache yet — chatbox itself can attach by `sessionId` regardless.
- Cross-tab freshness: when one tab fetches, other tabs receive the update via `storage` event (BrowserStore subscription). Acceptable v1; may flicker if both tabs fetch simultaneously.
- No optimistic creation here. All sidebar items reflect daemon truth after handshake.
