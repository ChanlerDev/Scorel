# S0049 WebUI Add Project And Directory Browser Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 WebUI 侧边栏加入“添加项目”，让用户选择 Device、浏览该 Device 的目录、注册 Project，并立即看到 Host Registry 的完整 Project 列表。

**Architecture:** WebUI 保持 Device-first。Project 是 Host 上 canonical 工作目录的稳定抽象，不是客户端 subscription。Browser 只通过 `DaemonClient` 调用 Host API，不直接读取或解释文件系统。S0048 已完成 `projectId`、route、store、cache 和 Session create 迁移；S0049 只实现目录浏览和注册 UI，并保留 Session 按 Project 懒加载。

**Tech Stack:** Next.js App Router、React、TypeScript、Vitest、Testing Library、现有 `@scorel/client`。

---

## Source Of Truth

- [`docs/spec/ship/S0049-webui-add-project-directory-browser.md`](../../spec/ship/S0049-webui-add-project-directory-browser.md)
- [`docs/plans/2026-06-01-s0049-webui-add-project-directory-browser-design.md`](../../plans/2026-06-01-s0049-webui-add-project-directory-browser-design.md)
- [`docs/spec/client.md`](../../spec/client.md)
- [`docs/spec/daemon.md`](../../spec/daemon.md)

## Precondition

- [ ] Confirm S0048 is implemented, committed, pushed, and Roadmap status is `Done`.
- [ ] Create branch `codex/S0049-webui-add-project-directory-browser`.
- [ ] Run `pnpm check` before editing WebUI.

## Already Completed By S0048

- [x] WebUI domain state uses `projectId`.
- [x] Project routes use `[projectId]`.
- [x] `syncProjects()` uses Registry entries.
- [x] `syncSessions()` sends `{ projectId }` and dedupes by Device + Project.
- [x] Session create sends `meta.projectId`.
- [x] attach cache scope uses Device + Project + Session.
- [x] stale slug-based browser storage is discarded.

## Task 1: Add Directory Browser Dialog Tests

**Files:**

- Create: `apps/webui/components/projects/add-project-dialog.test.tsx`

- [ ] Add failing test: no Device shows Settings guidance.
- [ ] Add failing test: one Device enters directory browsing directly.
- [ ] Add failing test: multiple Devices require Device selection.
- [ ] Add failing tests: loading, empty listing, and filesystem error.
- [ ] Add failing test: child navigation passes Host-returned child `path`.
- [ ] Add failing test: parent navigation passes Host-returned `parentPath`.
- [ ] Add failing test: choose current directory calls `registerProject(currentPath)`.
- [ ] Add failing test: registration error keeps dialog open and renders message.
- [ ] Add failing test: successful registration returns Host Project to caller.

Expected: tests fail because the dialog does not exist.

## Task 2: Implement Directory Browser Dialog

**Files:**

- Create: `apps/webui/components/projects/add-project-dialog.tsx`

- [ ] Implement Device selection.
- [ ] Resolve connected Device client through existing connection pool helpers.
- [ ] Call `client.listDirectories(path?)`.
- [ ] Render Host-returned canonical `path`, `parentPath`, and child entries.
- [ ] Do not concatenate, normalize, or reverse-parse paths in browser code.
- [ ] Call `client.registerProject(currentPath)` on confirmation.
- [ ] Keep dialog open with explicit error on list or registration failure.
- [ ] Run focused dialog tests.

Expected: dialog is transport-neutral and works for local or remote Devices.

## Task 3: Wire Sidebar Add Project

**Files:**

- Modify: `apps/webui/components/shell/sidebar.tsx`
- Modify: `apps/webui/components/shell/sidebar.test.tsx`

- [ ] Add failing sidebar tests for visible “添加项目” action.
- [ ] Add failing integration test: successful registration invokes `syncProjects()` for the selected Device.
- [ ] Add failing integration test: registration does not manually append a Project to browser store.
- [ ] Add failing integration test: successful registration expands and navigates to `/devices/:deviceId/projects/:projectId`.
- [ ] Render Add Project dialog from sidebar.
- [ ] After dialog success, call existing `syncProjects({ client, store, deviceId })`.
- [ ] Keep error visible when registration or sync fails.
- [ ] Run focused sidebar tests.

Expected: sidebar refreshes Host Registry truth after registration.

## Task 4: Preserve Lazy Session Loading

**Files:**

- Modify only if needed: `apps/webui/components/shell/project-node.tsx`
- Modify only if needed: `apps/webui/lib/sync/sessions.ts`
- Modify tests only if needed: related project node and sync tests

- [ ] Add or retain regression test: `syncProjects()` does not call `listSessions()`.
- [ ] Retain regression test: selecting or entering Project calls `listSessions({ projectId })`.
- [ ] Retain regression test: Session page loads JSONL only after Session selection.
- [ ] Do not add Project disable, visible-project subset, Session delete, Session archive, or `session-state.json`.

Expected: adding directory browsing does not widen Device connect into eager Session loading.

## Task 5: Documentation And Contract Cleanup

**Files:**

- Modify: `apps/webui/README.md`

- [ ] Document: adding a Device shows the complete Host Registry Project list.
- [ ] Document: Add Project browses the target Device Host filesystem.
- [ ] Document: Project registration is idempotent for the same canonical directory.
- [ ] Confirm ordinary WebUI does not expose `remove_project`.
- [ ] Run:

```bash
rg -n "projectSlug|workDirHint|visibleProject|session-state|archiveSession" apps/webui
```

Expected: no stale or overbuilt lifecycle state enters WebUI.

## Task 6: Verify And Ship

- [ ] Run `pnpm check`.
- [ ] Start `pnpm dev`.
- [ ] Add Device in WebUI.
- [ ] Add two real temporary repositories through sidebar directory browser.
- [ ] Confirm Device shows the complete Host Registry Project list.
- [ ] Expand both Projects and confirm Session lists load per Project.
- [ ] Create one Session under each Project.
- [ ] Send prompts through a real provider and verify cwd isolation.
- [ ] Refresh browser and verify Device -> Project -> Session restoration.
- [ ] Attach CLI to one Session and verify shared event stream.
- [ ] Update Roadmap status for S0049 only after all checks pass.
- [ ] Commit:

```bash
git add apps/webui docs
git commit -m "S0049: feat: add webui project directory browser"
```
