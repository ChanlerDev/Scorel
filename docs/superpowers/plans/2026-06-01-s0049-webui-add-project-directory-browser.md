# S0049 WebUI Add Project And Directory Browser Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 WebUI 侧边栏加入“添加项目”，让用户选择 Device、浏览该 Device 的目录、注册 Project，并在新 Project 下创建 Session。

**Architecture:** WebUI 继续保持 Device-first。Browser 只通过 `DaemonClient` 调用 Host 的目录浏览和 Project Registry API，不直接访问文件系统。所有 UI store、routes、cache 和 sync key 从 `projectSlug` 一次性切到 opaque `projectId`。

**Tech Stack:** Next.js App Router、React、TypeScript、Vitest、Testing Library、现有 `@scorel/client`。

---

## Source Of Truth

- [`docs/spec/ship/S0049-webui-add-project-directory-browser.md`](../../spec/ship/S0049-webui-add-project-directory-browser.md)
- [`docs/spec/client.md`](../../spec/client.md)
- [`docs/spec/daemon.md`](../../spec/daemon.md)

## Precondition

- [ ] Confirm S0048 is implemented, committed, pushed, and Roadmap status is `Done`.
- [ ] Run `pnpm typecheck && pnpm test` before editing WebUI.

## Task 1: Switch WebUI Domain State To projectId

**Files:**

- Modify: `apps/webui/lib/domain/devices.ts`
- Modify: `apps/webui/lib/store/devices.ts`
- Modify: `apps/webui/lib/store/devices.test.ts`
- Modify: `apps/webui/lib/store/browser-store.ts`
- Modify: `apps/webui/lib/store/browser-store.test.ts`
- Modify: `apps/webui/lib/store/last-active-project.ts`
- Modify: `apps/webui/lib/store/last-active-project.test.ts`

- [ ] Write failing tests for `DeviceProject.projectId`, `workDir`, store version bump, and last-active Project by ID.
- [ ] Delete slug-based store migration and snapshots.
- [ ] Update all store indexing to `projectId`.
- [ ] Run `pnpm --filter @scorel/webui test -- lib/store`.

Expected: stale browser state is discarded instead of migrated.

## Task 2: Switch Sync, Session Create, Cache And Diagnostics

**Files:**

- Modify: `apps/webui/lib/sync/projects.ts`
- Modify: `apps/webui/lib/sync/projects.test.ts`
- Modify: `apps/webui/lib/sync/sessions.ts`
- Modify: `apps/webui/lib/sync/sessions.test.ts`
- Modify: `apps/webui/lib/sync/session-create.ts`
- Modify: `apps/webui/lib/sync/session-create.test.ts`
- Modify: `apps/webui/lib/identity/scope-key.ts`
- Modify: `apps/webui/lib/identity/scope-key.test.ts`
- Modify: `apps/webui/lib/diagnostics/connection-summary.ts`
- Modify: `apps/webui/lib/diagnostics/connection-summary.test.ts`
- Modify: `apps/webui/lib/connection/use-connection.ts`
- Modify: `apps/webui/lib/connection/session.ts`

- [ ] Write failing tests for `listSessions({ projectId })`, dedupe by `deviceId + projectId`, Session create with `meta.projectId`, and cache scope by Project ID.
- [ ] Replace slug-based names and comments.
- [ ] Keep URL as transport locator only.
- [ ] Run `pnpm --filter @scorel/webui test -- lib`.

Expected: internal WebUI state no longer assumes path-derived identity.

## Task 3: Move Project Routes

**Files:**

- Move: `apps/webui/app/devices/[deviceId]/projects/[projectSlug]`
- To: `apps/webui/app/devices/[deviceId]/projects/[projectId]`
- Modify: `apps/webui/src/routes.test.ts`
- Modify: `apps/webui/components/shell/project-node.tsx`
- Modify: `apps/webui/components/shell/project-node.test.tsx`
- Modify: `apps/webui/components/shell/session-node.tsx`
- Modify: `apps/webui/components/shell/session-node.test.tsx`
- Modify: `apps/webui/components/shell/new-chat-button.tsx`
- Modify: `apps/webui/components/shell/new-chat-button.test.tsx`

- [ ] Change route tests first and confirm they fail.
- [ ] Move route directory with `git mv`.
- [ ] Replace route params, labels, hrefs, and pending prompt keys with `projectId`.
- [ ] Use `displayName ?? projectId` only for UI fallback.
- [ ] Run `pnpm --filter @scorel/webui test -- src/routes.test.ts components/shell`.

Expected: routes carry opaque Project ID and retain readable labels.

## Task 4: Add Directory Browser Dialog

**Files:**

- Create: `apps/webui/components/projects/add-project-dialog.tsx`
- Create: `apps/webui/components/projects/add-project-dialog.test.tsx`

- [ ] Write failing tests for Device selection, initial listing, child navigation, parent navigation, loading, empty state, filesystem error, registration success, and registration failure.
- [ ] Implement dialog state around `client.listDirectories()` and `client.registerProject()`.
- [ ] Always render Host-returned `path` and `parentPath`; do not interpret remote path syntax in browser code.
- [ ] Keep dialog open on error.
- [ ] Run `pnpm --filter @scorel/webui test -- add-project-dialog`.

Expected: dialog is transport-neutral and works for local or remote Device.

## Task 5: Wire Sidebar Add Project

**Files:**

- Modify: `apps/webui/components/shell/sidebar.tsx`
- Modify: `apps/webui/components/shell/sidebar.test.tsx`
- Modify: `apps/webui/components/chatbox/empty-composer.tsx`
- Modify: `apps/webui/components/chatbox/empty-composer.test.tsx`
- Modify: relevant project and session route tests under `apps/webui/app/devices`

- [ ] Add failing sidebar tests for no Device, one Device, multiple Devices, success auto-select, and error visibility.
- [ ] Add the visible “添加项目” action in sidebar.
- [ ] After registration, refresh Project list and navigate to the new Project.
- [ ] Ensure all New Chat entry points create Session with selected `projectId`.
- [ ] Run `pnpm --filter @scorel/webui test`.

Expected: adding a Project is discoverable from the primary sidebar.

## Task 6: Clean Old WebUI Contract

- [ ] Run:

```bash
rg -n "projectSlug|workDirHint" apps/webui
```

- [ ] Remove all current production and test hits.
- [ ] Update `apps/webui/README.md` with the Add Project flow.
- [ ] Confirm old browser local storage is intentionally discarded.

Expected: no stale slug contract remains in WebUI.

## Task 7: Verify And Ship

- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Start `pnpm dev`.
- [ ] Add two real temporary repositories from sidebar.
- [ ] Create one Session under each Project.
- [ ] Send prompts through a real provider.
- [ ] Refresh browser and verify Device -> Project -> Session restoration.
- [ ] Attach CLI to one Session and verify shared event stream.
- [ ] Update Roadmap status for S0049 only after all checks pass.
- [ ] Commit:

```bash
git add apps/webui docs
git commit -m "S0049: feat: add webui project directory browser"
git push origin main
```
