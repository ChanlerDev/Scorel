# S0049 — WebUI Add Project And Directory Browser

## Goal

让 WebUI 侧边栏出现正式的“添加项目”入口。用户选择 Device，浏览该 Device 的目录，注册工作空间，并立即在 Device -> Project -> Session 树中看到新 Project。

## Dependency

必须先完成 [`S0048`](S0048-device-level-host-project-registry.md)。

## Product Flow

WebUI 是联机产品，保持 Device-first：

```text
点击侧边栏“添加项目”
  → 选择 Device
  → 浏览该 Device 文件夹
  → 选择工作目录
  → register_project
  → 同步 Project 列表
  → 选中新 Project
  → 可直接新增 Session
```

本地 Device 和远程 Device 使用同一套 Host API。WebUI 不直接读取浏览器所在机器的文件系统。

## Scope

### 1. WebUI Domain Model

删除 slug-based Project shape：

```typescript
interface DeviceProject {
  projectId: string;
  displayName: string;
  workDir: string;
  sessions: SessionSummary[];
  sessionsFetchedAt?: number;
}
```

更新：

- Browser store
- sidebar tree
- session sync
- pending prompt
- attach cache scope
- last active Project persistence
- route params

### 2. Routes

将 Project 路由从 `projectSlug` 切换到 `projectId`：

```text
/devices/[deviceId]/projects/[projectId]
/devices/[deviceId]/projects/[projectId]/sessions/[sessionId]
```

URL 只承载 opaque ID，不反向编码 path。

### 3. Sidebar Add Project

在 sidebar 的 Project 区域增加“添加项目”按钮：

- 没有 Device 时按钮引导用户先添加 Device。
- 有一个 Device 时可直接进入目录浏览。
- 有多个 Device 时先选择 Device。
- 注册成功后自动展开并选中新 Project。
- 注册失败时显示明确错误，不静默吞掉。

### 4. Directory Browser Dialog

新增 modal/dialog：

- 显示当前 Device。
- 显示当前 canonical path。
- 支持进入子目录。
- 支持返回 parent。
- 支持选择当前目录作为 Project。
- loading、empty、filesystem error 都有明确状态。
- 不在浏览器自行拼接路径语义；使用 Host 返回的 `path` 和 `parentPath`。

### 5. New Session

新增 Session 必须传：

```typescript
client.createSession({
  meta: {
    projectId,
    model,
    title: "New chat",
  },
});
```

新 Session 跳转到 projectId route。空态 composer、Project hover new-chat、Project 页面 new-chat 都使用同一 helper。

### 6. Existing Devices

S0048 是破坏性协议升级。WebUI 直接 bump browser store version：

- 丢弃旧 `projectSlug` snapshot。
- 丢弃旧 slug-based attach cache。
- 丢弃旧 last-active-project map。
- 不做迁移。

## Explicitly Not In Scope

- GUI desktop app。
- SSH 配置导入、安装远端 Scorel、SSH proxy。
- 账号密码、权限分级、ACL。
- Project rename、pin、recent list。
- IDE-style file explorer。
- HTTP API。

## Required Tests

### Store

- DeviceProject 以 `projectId` 索引。
- browser store version bump 后不读取旧 slug snapshot。
- last active Project 保存 `projectId`。

### Sync

- `syncProjects(deviceId)` 使用 Registry 返回值。
- `syncSessions(deviceId, projectId)` 发送 projectId filter。
- 并发 dedupe key 使用 `deviceId + projectId`。

### Add Project Dialog

- 无 Device 时显示引导。
- 多 Device 时先选择 Device。
- 目录列表 loading / empty / error。
- parent navigation。
- 选择当前目录后调用 `registerProject(workDir)`。
- 成功后同步并选中新 Project。
- 失败时保持 dialog 打开并显示错误。

### Routes And Composer

- sidebar route 使用 projectId。
- Project hover new-chat 使用 projectId。
- 首页 composer、Project page composer、session route pending prompt 都使用 projectId。
- attach cache scope 使用 `deviceId + projectId + sessionId`。

### Real Manual Smoke

1. `scorel up` 启动真实 Host 和 WebUI。
2. 在侧边栏点击“添加项目”。
3. 浏览并注册两个不同的真实临时仓库。
4. 分别创建 Session。
5. 通过真实 provider 在两个 Session 发送 prompt。
6. 刷新页面，确认 Device -> Project -> Session 树恢复。
7. CLI attach 其中一个 Session，确认 WebUI 可见同一事件流。

不要使用 fake/mock provider 代替真实产品 smoke。

## Likely Files

```text
apps/webui/lib/domain/device.ts
apps/webui/lib/store/browser-store.ts
apps/webui/lib/client/device-client-pool.ts
apps/webui/lib/sync/project-session-sync.ts
apps/webui/lib/cache/attach-cache.ts
apps/webui/components/sidebar.tsx
apps/webui/components/add-project-dialog.tsx
apps/webui/components/empty-composer.tsx
apps/webui/app/devices/[deviceId]/projects/[projectId]/page.tsx
apps/webui/app/devices/[deviceId]/projects/[projectId]/sessions/[sessionId]/page.tsx
```

## Done When

- WebUI 侧边栏可通过 Host 目录浏览注册 Project。
- 全部 WebUI Project 身份切到 `projectId`。
- 新 Session 总是归属所选 Project。
- 自动测试和真实双 Project WebUI smoke 通过。
- 完成后 commit：`S0049: feat: add webui project directory browser`
