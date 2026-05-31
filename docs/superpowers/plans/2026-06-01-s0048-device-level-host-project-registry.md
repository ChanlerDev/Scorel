# S0048 Device-level Host And Project Registry Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将单 cwd daemon 升级为 Device-level Host，让一个 Host 持久管理多个 Project，并通过 `projectId` 为 Session 和 Runtime 解析正确工作目录。

**Architecture:** `@scorel/daemon` 新增 Host-owned `ProjectRegistry`，替换 JSONL `ProjectAggregator`。协议直接从 `projectSlug` 切到 opaque `projectId`；`ScorelHost` 在创建或恢复 Session 时查询 Registry，并把 `HostProject` 传入 runtime factory。当前 pre-1.0，不保留旧 schema 或缓存兼容层。

**Tech Stack:** TypeScript、Vitest、Node `fs/promises`、现有 `@scorel/protocol` / `@scorel/core` / `@scorel/daemon` / `@scorel/client`。

---

## Source Of Truth

- [`docs/spec/ship/S0048-device-level-host-project-registry.md`](../../spec/ship/S0048-device-level-host-project-registry.md)
- [`docs/decisions/006-device-host-project-registry.md`](../../decisions/006-device-host-project-registry.md)
- [`docs/spec/daemon.md`](../../spec/daemon.md)
- [`docs/spec/client.md`](../../spec/client.md)

## Task 1: Replace Protocol Project Identity

**Files:**

- Modify: `packages/protocol/src/ids.ts`
- Modify: `packages/protocol/src/events.ts`
- Modify: `packages/protocol/src/transport.ts`
- Modify: `packages/protocol/src/wire.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/index.test.ts`

- [ ] Add failing tests for `ProjectId`, `HostProjectSummary`, `DirectoryListing`, project registry requests, `SessionMeta.projectId`, and `protocolVersion` bump.
- [ ] Remove `projectSlug` and `workDirHint` from current protocol types.
- [ ] Run `pnpm --filter @scorel/protocol test`.
- [ ] Run `rg -n "projectSlug|workDirHint" packages/protocol`.

Expected: protocol tests pass and `rg` returns no current protocol hits.

## Task 2: Add Persistent Project Registry

**Files:**

- Create: `packages/daemon/src/projects/registry.ts`
- Create: `packages/daemon/src/projects/registry.test.ts`
- Delete: `packages/daemon/src/projects/aggregator.ts`
- Delete: `packages/daemon/src/projects/aggregator.test.ts`
- Delete: `packages/daemon/src/projects/slug.ts`
- Delete: `packages/daemon/src/projects/slug.test.ts`

- [ ] Write failing tests for canonical-path idempotency, restart persistence, stable ordering, missing path, non-directory path, remove-without-file-deletion, and rejecting removal while Sessions still reference the Project.
- [ ] Implement versioned `~/.scorel/projects.json` storage with injected test path.
- [ ] Generate opaque `prj_<uuid>` IDs in Host code.
- [ ] Run `pnpm --filter @scorel/daemon test -- registry`.

Expected: registry tests pass without Session JSONL aggregation.

## Task 3: Upgrade EmbeddedDaemon Into Device-level Host

**Files:**

- Modify: `packages/daemon/src/index.ts`
- Modify: `packages/daemon/src/index.test.ts`
- Modify: `packages/daemon/src/protocol.test.ts`
- Modify: `packages/daemon/src/embedded/embedded.test.ts`

- [ ] Add a failing two-project integration test: register two temp repos, create one Session per Project, assert runtime factory receives the correct canonical cwd for each.
- [ ] Add failing tests for `list_directories`, `register_project`, `list_projects`, `remove_project`, and project-filtered `list_sessions`.
- [ ] Replace startup `workDir` identity with injected `ProjectRegistry`.
- [ ] Resolve Project before runtime creation and Session restore.
- [ ] Rename public concept to `ScorelHost`; keep a short-lived internal alias only if needed to make the refactor reviewable, then remove it before ship.
- [ ] Preserve per-session JSONL and diagnostics `.log`.
- [ ] Run `pnpm --filter @scorel/daemon test`.

Expected: one Host serves two Project cwd values without cross-contamination.

## Task 4: Update DaemonClient And Attach Cache Identity

**Files:**

- Modify: `packages/client/src/index.ts`
- Modify: `packages/client/src/daemon-client.test.ts`
- Modify: `packages/client/src/index.test.ts`

- [ ] Add failing tests for daemon-only Project operations and `listSessions({ projectId })`.
- [ ] Implement `listDirectories()`, `registerProject()`, `listProjects()`, and `removeProject()`.
- [ ] Switch attach cache identity metadata to `deviceId + projectId + sessionId`.
- [ ] Delete slug fallback behavior.
- [ ] Run `pnpm --filter @scorel/client test`.

Expected: Client can manage Project Registry before binding a Session.

## Task 5: Adapt CLI Entry Points

**Files:**

- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/index.test.ts`
- Modify: `apps/cli/src/daemon-cli.ts`
- Modify: `apps/cli/src/daemon-cli.test.ts`
- Modify: `apps/cli/src/up-cli.ts`
- Modify: `apps/cli/src/up-cli.test.ts`

- [ ] Add failing tests showing `scorel chat --cwd` registers cwd as a Project before creating a Session.
- [ ] Add failing tests showing `scorel daemon serve` no longer treats cwd as Host identity.
- [ ] Keep `scorel up --cwd` as initial Project registration convenience.
- [ ] Add `scorel project list|add|remove` if the command surface remains small; otherwise expose tested helpers and record CLI commands as the next narrow spec.
- [ ] Run `pnpm --filter @scorel/cli test`.

Expected: CLI local flow remains usable while Host becomes multi-project.

## Task 6: Delete Old Local State Contract

**Files:**

- Modify only where current code still references old state under `apps/cli`, `packages/client`, or `packages/daemon`.

- [ ] Delete reads and writes of `~/.scorel/project-index.json`.
- [ ] Delete slug-based attach cache key handling.
- [ ] Document the local development cleanup before manual smoke:

```bash
rm -rf ~/.scorel/sessions ~/.scorel/attach-cache
rm -f ~/.scorel/project-index.json
```

- [ ] Run:

```bash
rg -n "projectSlug|workDirHint|ProjectAggregator|project-index" packages apps/cli
```

Expected: no production-path hits remain. Historical docs may still mention removed names.

## Task 7: Verify And Ship

- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Start one real WS Host.
- [ ] Register two real temporary git repositories.
- [ ] Create one Session per Project with a real provider.
- [ ] Confirm each Session executes against its own cwd.
- [ ] Attach remotely to one Session and verify recovery.
- [ ] Update Roadmap status for S0048 only after all checks pass.
- [ ] Commit:

```bash
git add packages apps docs
git commit -m "S0048: feat: add device-level host project registry"
git push origin main
```
