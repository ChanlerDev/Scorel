# S0049 — WebUI Add Project And Directory Browser

## Goal

让 WebUI 侧边栏出现正式的“添加项目”入口。用户选择 Device，浏览该 Device 的目录，注册工作空间，并立即在 Device -> Project -> Session 树中看到新 Project。

S0049 继续保持 Device-first：

- WebUI 添加的是 Device，不是 Project subscription。
- Project 只是 owning Host 上 canonical 工作目录的稳定抽象。
- 连接 Device 后，WebUI 展示该 Host Registry 中的全部 Project。
- 展开 Project 时才按 `projectId` 查询 Session。
- 点击 Session 时才加载 JSONL，并按需创建 Runtime。

## Dependency

必须先完成 [`S0048`](S0048-device-level-host-project-registry.md)。

S0048 已完成以下基础迁移，S0049 不重复实现：

- WebUI Project 身份已经从 `projectSlug` 切到 `projectId`。
- Project route 已经使用 `[projectId]`。
- attach cache scope 已经使用 `deviceId + projectId + sessionId`。
- `syncProjects(deviceId)` 已经使用 Registry 返回值。
- `syncSessions(deviceId, projectId)` 已经发送 `projectId` filter，并按 Device + Project 去重。
- New Session 已经传递 `meta.projectId`。

## Product Model

```text
Device
  -> listProjects() 展示 Host Registry 中全部 Project
    -> 展开 Project 时 listSessions({ projectId })
      -> 点击 Session 时 loadSession(sessionId)
        -> Host 按 projectId 解析 canonical workDir
          -> 按需创建 Runtime
```

Project Registry 是 Host 已知工作目录的权威集合。UI 不再增加一套 visible Project、pin、disable 或 archive 状态。

Session JSONL 是 Project 下的持久历史。UI 不增加 Session delete、archive 或额外状态文件。

## Product Flow

```text
点击侧边栏“添加项目”
  -> 选择 Device
  -> 浏览该 Device 文件夹
  -> 选择当前工作目录
  -> register_project
  -> Host canonicalize 路径并幂等返回 Project
  -> WebUI 重新调用 list_projects
  -> 展示该 Device 的完整 Project Registry
  -> 自动展开并选中新 Project
  -> 可直接新增 Session
```

本地 Device 和远程 Device 使用同一套 Host API。WebUI 不直接读取浏览器所在机器的文件系统，也不自行解释远端路径。

## Scope

### 1. Sidebar Add Project

在 sidebar 的 Device / Project 区域增加正式“添加项目”入口：

- 没有 Device 时，引导用户先添加 Device。
- 有一个 Device 时，直接进入该 Device 的目录浏览。
- 有多个 Device 时，先选择 Device。
- 注册成功后重新同步该 Device 的完整 Project 列表。
- 自动展开并选中新 Project。
- 注册失败时显示明确错误，不静默吞掉。

### 2. Directory Browser Dialog

新增 modal/dialog：

- 显示当前 Device。
- 显示 Host 返回的 canonical current path。
- 支持进入直接子目录。
- 支持返回 Host 返回的 parent path。
- 支持选择当前目录作为 Project。
- loading、empty、filesystem error 都有明确状态。
- 浏览器不得自行拼接、规范化或反向解析路径。
- 目录导航只使用 Host 返回的 `path` 和 `parentPath`。

### 3. Registry Refresh

注册成功后：

1. 调用 `client.registerProject(workDir)`。
2. 调用现有 `syncProjects({ client, store, deviceId })`。
3. 使用返回 Project 的 `projectId` 展开并跳转：

```text
/devices/:deviceId/projects/:projectId
```

`registerProject()` 对同一 canonical path 必须幂等。重复添加同一路径时复用已有 `projectId`，不能制造重复 Project。

### 4. Session Lazy Loading

保持现有懒加载边界，不引入额外 Session 生命周期：

- `syncProjects()` 不加载 Session。
- 展开或进入 Project 时调用 `listSessions({ projectId })`。
- 点击 Session 时调用 `loadSession(sessionId)`。
- Session JSONL 不删除、不归档。
- Host 不为 Registry 中每个 Project 常驻创建 Runtime。

### 5. Existing Device Behavior

连接已有 Device 后，WebUI 继续调用 `listProjects()` 并展示 Host Registry 全集。

- 不保存客户端侧 visible Project 子集。
- 不实现 Project pin / unpin。
- 不区分本地 Device 与远端 Device 的 Project 展示规则。
- 添加 Project 始终通过目标 Device 的 Host 目录浏览完成。

## Explicitly Not In Scope

- GUI desktop app。
- SSH 配置导入、安装远端 Scorel、SSH proxy。
- 账号密码、权限分级、ACL。
- Project rename、pin、recent list、disable、archive。
- 普通 WebUI 的 Project remove 操作。
- Session delete、archive、unarchive 或额外 `session-state.json`。
- IDE-style file explorer。
- HTTP API。
- 为每个 Registry Project 常驻 Runtime。
- S0048 已完成的 `projectId` route、cache 和 store 迁移。

`remove_project` 若继续存在，只是底层 Host 管理 API。S0049 普通 WebUI 不调用它，也不扩展它。

## Required Tests

### Add Project Dialog

- 无 Device 时显示添加 Device 引导。
- 单 Device 时直接浏览该 Device。
- 多 Device 时先选择 Device。
- 初始目录加载状态。
- 目录列表 empty 状态。
- filesystem error 状态。
- child navigation 使用 Host 返回的 child `path`。
- parent navigation 使用 Host 返回的 `parentPath`。
- 选择当前目录后调用 `registerProject(workDir)`。
- 重复注册同一目录时接受 Host 返回的已有 Project。
- 注册失败时保持 dialog 打开并显示错误。

### Sidebar Integration

- sidebar 存在“添加项目”入口。
- 注册成功后调用 `syncProjects(deviceId)`，而不是仅向浏览器 store 手工 append。
- 同步后展示 Device Registry 全集。
- 注册成功后自动展开并跳转到 `projectId` route。
- 普通 UI 不调用 `removeProject()`。

### Lazy Loading Regression

- `syncProjects(deviceId)` 不调用 `listSessions()`。
- 展开或进入 Project 时调用 `listSessions({ projectId })`。
- 点击 Session 时调用 `loadSession(sessionId)`。
- 不新增 Session archive / delete 状态。

### Existing S0048 Regression

- Project route 继续使用 `projectId`。
- New Session 继续携带 `meta.projectId`。
- attach cache scope 继续使用 `deviceId + projectId + sessionId`。
- browser store 不读取旧 slug snapshot。

### Real Manual Smoke

1. `scorel up` 启动真实 Host 和 WebUI。
2. 在 WebUI 添加 Device。
3. 在侧边栏点击“添加项目”。
4. 通过目标 Device 的目录浏览注册两个不同真实临时仓库。
5. 确认 Device 下展示 Host Registry 的两个 Project。
6. 分别展开两个 Project，确认按 Project 懒加载 Session。
7. 分别创建 Session。
8. 通过真实 provider 在两个 Session 发送 prompt，确认 Runtime cwd 不串线。
9. 刷新页面，确认 Device -> Project -> Session 树恢复。
10. CLI attach 其中一个 Session，确认 WebUI 可见同一事件流。

不要使用 fake/mock provider 代替真实产品 smoke。

## Likely Files

```text
apps/webui/components/shell/sidebar.tsx
apps/webui/components/shell/sidebar.test.tsx
apps/webui/components/projects/add-project-dialog.tsx
apps/webui/components/projects/add-project-dialog.test.tsx
apps/webui/lib/connection/pool.ts
apps/webui/lib/connection/use-connection.ts
apps/webui/lib/sync/projects.ts
apps/webui/lib/sync/projects.test.ts
apps/webui/README.md
```

## Risks And Boundaries

- 目录浏览发生在目标 Device Host，不是浏览器所在机器。
- 浏览器不得假设 POSIX 路径，也不得自行拼接路径。
- Registry Project 数量增长时，`listProjects()` 仍是 Device 级全集；客户端侧筛选不是 S0049 的优化方向。
- Session 列表必须保持按 Project 懒加载，避免 Device 连接时扫描并加载全部 Session。
- 普通 UI 不暴露底层 `remove_project`，避免把工作目录管理误解为 Session 删除。

## Done When

- WebUI 侧边栏可通过 Host 目录浏览注册 Project。
- 添加 Device 后展示该 Host Registry 的全部 Project。
- 重复注册同一路径不会产生重复 Project。
- Session 继续按 Project 懒加载，Runtime 继续按 Session 按需创建。
- 普通 WebUI 不提供 Project remove、Project disable 或 Session archive。
- 自动测试和真实双 Project WebUI smoke 通过。
- 完成后 commit：`S0049: feat: add webui project directory browser`
