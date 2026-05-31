# S0048 — Device-level Host And Project Registry

## Goal

把当前“一次 daemon serve 只服务一个启动 cwd”的实现升级为 Device-level Host：

- 一个 Device 只有一个逻辑 Host。
- Host 持久管理本机多个 Project。
- `projectId` 取代 `projectSlug` 成为稳定身份。
- Session 必须归属 Project。
- Runtime 创建必须根据 Session 的 Project 解析 canonical `workDir`。

这是 GUI、WebUI 添加项目、SSH 远程设备和纯 HTTP API 的共同地基。

## Why Now

当前 M5 WebUI 通过 Session JSONL 聚合 `projectSlug`，只能展示 daemon 启动时的单一工作目录。这个模型无法支持：

- 在同一个 Device 上添加多个工作目录。
- GUI 像 Codex App 一样管理本地和远程 Project。
- WebUI 从侧边栏浏览目录并添加 Project。
- API 客户端先注册 Project，再创建 Session。

在继续堆 UI 前必须先把 Host 的领域模型改正确。

## Scope

### 1. Protocol

新增：

```typescript
type ProjectId = string & { readonly __brand: "ProjectId" };

interface HostProject {
  projectId: ProjectId;
  displayName: string;
  workDir: string;
  createdAt: number;
  updatedAt: number;
}

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

修改：

- `SessionMeta.projectId` 必填。
- `SessionSummary.projectId` 必填。
- `connected` handshake 只报告 Device identity，不报告单 Project identity。
- `list_sessions` filter 改为 `{ projectId?: ProjectId; limit?: number }`。
- `list_projects` 从 Registry 返回 `HostProject[]`。
- 新增 `list_directories`、`register_project`、`remove_project`。
- bump `protocolVersion`。

删除：

- `projectSlug`
- `workDirHint`
- 任何把 daemon startup cwd 当连接身份的字段

### 2. Project Registry

新增 Host-owned persistence：

```text
~/.scorel/projects.json
```

规则：

- Registry 是 Project 的权威索引。
- `registerProject(workDir)` 先 realpath/canonicalize，再校验 directory 存在。
- 同一 canonical path 重复注册返回已有 Project，保持幂等。
- `projectId` 由 Host 生成，不能由 client 路径 slug 计算。
- `displayName` 默认取目录 basename，后续可扩展 rename。
- `removeProject(projectId)` 只允许移除没有 Session 的 Registry 项，不删除 session JSONL 或工作区文件。仍有 Session 时返回明确冲突错误。

### 3. Device-level Host

将 `EmbeddedDaemon` 的核心能力升级为 `ScorelHost`。允许在实现过程中保留内部类名作为短期机械步骤，但公开概念、API 和测试必须使用 Host 语义。

Host options 不再接收单一 `workDir`。改为：

```typescript
interface ScorelHostOptions {
  deviceId: DeviceId;
  sessionsDir: string;
  projectsPath: string;
  createRuntime(project: HostProject, sessionId: SessionId): Promise<ScorelRuntime>;
}
```

Host 根据 `SessionMeta.projectId` 查询 Registry，再把 Project 交给 runtime factory。

### 4. CLI Entry

- `scorel chat --cwd <path>`：创建 embedded Host，注册 cwd，创建或恢复该 Project 下的 Session。
- `scorel daemon serve`：启动 Device-level WS Host，不把 `--cwd` 当身份。
- `scorel up --cwd <path>`：可把 cwd 作为启动后的首个注册 Project，作为便捷入口。
- 新增最小 CLI 管理面：

```text
scorel project list
scorel project add <path>
scorel project remove <projectId>
```

CLI 管理命令连接已有 WS Host；若实现选择不在 S0048 暴露命令，也必须至少提供等价 integration helper 供 S0049 和测试调用。

### 5. Directory Browsing

Host 暴露 `listDirectories(path?)`：

- path 省略时从用户 home 开始。
- 返回 canonical current path、可选 parent path、直接子目录。
- 只返回 directory。
- 稳定排序。
- 当前开发阶段不做 workspace root restriction、ACL 或 permission prompt。
- filesystem error 映射为明确 wire error。

### 6. Session Persistence

新的 Session header 必须写入 `meta.projectId`。旧 `projectSlug` header 不迁移。

实现切换时允许清理开发机上的旧产物：

```text
~/.scorel/sessions/*
~/.scorel/attach-cache/*
```

Registry 文件使用新的 `~/.scorel/projects.json`。不继续写 `~/.scorel/project-index.json`。

### 7. Attach Cache

远程 attach scope 改为：

```text
deviceId + projectId + sessionId
```

删除旧 slug-based cache key 和 fallback。

### 8. Diagnostics

日志增加：

- `project_registered`
- `project_removed`
- `project_resolved`
- `directory_listed`

日志可记录 `projectId` 和 canonical path，不得记录 token、API key 或 SSH secret。

## Explicitly Not In Scope

- WebUI Add Project UI，见 S0049。
- GUI desktop app。
- SSH 安装、SSH proxy 和远端 supervisor。
- HTTP API adapter。
- ACL、角色、scope、sandbox 和 permission approval。
- Project rename。
- 每个 Project 一个 worker process。
- 旧状态迁移或协议兼容。

## Destructive Refactor Rules

Scorel 当前 pre-1.0。本 spec 直接删除旧模型：

- 不保留 `projectSlug` alias。
- 不做 `projectSlug -> projectId` dual write。
- 不读取旧 `project-index.json`。
- 不读取旧 WebUI local storage shape。
- 不保留旧 client/server protocol negotiation。

旧 Client 连接新 Host 时应因 `protocolVersion` 不匹配明确失败。

## Required Tests

### Protocol

- `SessionMeta.projectId` 和新增 request/response schema round-trip。
- 不再导出 `projectSlug` 或 `workDirHint`。

### Registry

- 注册 canonical path 幂等。
- 不存在路径和非目录路径失败。
- Registry 重启后可恢复。
- remove 对仍有 Session 的 Project 返回冲突错误；成功 remove 不删除 workspace 文件。

### Host

- 同一 Host 注册两个临时仓库。
- 分别在两个 Project 创建 Session。
- 两个 Runtime 的 cwd 正确隔离。
- `listSessions({ projectId })` 只返回对应 Session。
- Host 重启后 Registry 和 Session 归属仍正确。

### Directory Browser

- home 默认起点。
- parent path。
- 只返回子目录并稳定排序。
- filesystem error 映射。

### Client

- daemon-only handshake 后可 list/register/remove Project。
- session-bound 操作仍要求绑定 Session。
- attach cache scope 使用 `deviceId + projectId + sessionId`。

### CLI And Real Smoke

- `scorel chat --cwd <repo-a>` 能使用真实 provider 完成一轮。
- 同一 `scorel daemon serve` 注册 `<repo-a>` 和 `<repo-b>`。
- 对两个 Project 分别创建 Session，真实 provider 回答中可观测 cwd 不串线。
- `scorel attach --remote` 可恢复其中一个 Session。

不要使用 fake/mock provider 代替真实产品 smoke。

## Likely Files

```text
packages/protocol/src/ids.ts
packages/protocol/src/events.ts
packages/protocol/src/wire.ts
packages/daemon/src/index.ts
packages/daemon/src/projects/registry.ts
packages/daemon/src/ws-server.ts
packages/client/src/index.ts
apps/cli/src/index.ts
apps/cli/src/daemon-cli.ts
apps/cli/src/up-cli.ts
```

## Done When

- 一个 WS Host 能管理至少两个 Project。
- Project 来自持久 Registry，不再来自 Session 聚合。
- Session 和 Runtime 都按 `projectId` 解析 cwd。
- `projectSlug` 和 `workDirHint` 从当前代码、协议和非历史文档中删除。
- 自动测试、typecheck 和真实双 Project smoke 通过。
- 完成后 commit：`S0048: feat: add device-level host project registry`
