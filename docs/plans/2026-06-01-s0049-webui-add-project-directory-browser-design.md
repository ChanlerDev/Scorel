# S0049 WebUI Add Project And Directory Browser Design

## Context

S0048 已将 daemon 升级为 Device-level Host：

- Host Registry 持久保存 canonical 工作目录。
- `projectId` 是 Project 稳定身份。
- Session header 保存 `projectId`。
- Runtime 根据 Session 所属 Project 按需解析 `workDir`。
- WebUI route、store、sync 和 attach cache 已切换到 `projectId`。

S0049 不再承担底层身份迁移。它只补齐 WebUI 的目录浏览和 Project 注册入口。

## Product Decision

WebUI 是 Device-first 产品。用户添加 Device 后，WebUI 展示该 Host Registry 中的全部 Project。

Project 只是 owning Host 上工作目录的稳定抽象，不是客户端 subscription。WebUI 不保存 visible Project 子集，也不实现 pin、disable 或 archive。

Session 是 Project 下的持久历史：

- 展开 Project 时调用 `listSessions({ projectId })`。
- 点击 Session 时调用 `loadSession(sessionId)`。
- Host 只在 Session 真正打开或执行时按需创建 Runtime。
- 不增加 Session delete、archive、unarchive 或额外状态文件。

## User Flow

```text
Sidebar 添加项目
  -> 选择 Device
  -> 调用目标 Host listDirectories(path?)
  -> 用户浏览并选择当前目录
  -> 调用 registerProject(workDir)
  -> Host canonicalize 并幂等返回 Project
  -> WebUI 调用 syncProjects(deviceId)
  -> 展示 Host Registry 全集
  -> 跳转 /devices/:deviceId/projects/:projectId
```

单 Device 时直接进入目录浏览。多 Device 时先选择 Device。没有 Device 时引导用户前往 Settings。

## Directory Browser Boundary

目录浏览发生在目标 Device Host，不是浏览器所在机器。

WebUI 只消费 Host 返回值：

```typescript
interface DirectoryListing {
  path: string;
  parentPath?: string;
  entries: Array<{
    name: string;
    path: string;
    kind: "directory";
  }>;
}
```

浏览器不得自行拼接、规范化或反向解析路径，也不得假设 POSIX 路径格式。

## Registry Refresh

注册成功后必须重新调用 `syncProjects()`，不能只向 BrowserStore 手工 append 新 Project。

原因：

- Registry 是 Project 权威来源。
- 重复注册同一 canonical 路径会返回已有 `projectId`。
- 全量同步可以保持当前 Device 的 BrowserStore 与 Host 一致。

## Error Handling

- 目录加载失败：Dialog 保持打开并展示错误。
- 目录为空：展示 empty state，仍允许选择当前目录。
- 注册失败：Dialog 保持打开并展示错误。
- Device 尚未连接：展示明确错误，不静默失败。
- 同步失败：保留 Dialog 或错误状态，避免展示未确认成功的本地投影。

## Explicit Non-Goals

- 不修改 protocol 或 Registry schema。
- 不修改 `protocolVersion`。
- 不增加客户端 Project 可见性状态。
- 不实现 Project remove、disable、archive。
- 不实现 Session delete、archive、unarchive。
- 不为 Registry 中每个 Project 常驻 Runtime。
- 不提前实现 GUI、SSH 或 HTTP adapter。

底层 `remove_project` 若保留，只属于未来 Host 管理能力。普通 WebUI 不调用它。

## Verification

- Dialog 单元测试覆盖 Device 选择、目录导航、loading、empty、filesystem error、注册成功和失败。
- Sidebar 集成测试覆盖同步 Registry 全集和跳转。
- 回归测试锁定 Session 按 Project 懒加载。
- `pnpm check` 全绿。
- 真实 WebUI smoke：两个临时仓库、两个 Project、两个 Session、真实 provider cwd 隔离、刷新恢复、CLI attach。
