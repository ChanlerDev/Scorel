# ADR-006: Device-level Host And Project Registry

**状态**：已确认
**日期**：2026-06-01
**参与者**：Chanler, Codex

## 决策

Scorel 的 daemon 升级为 **Device-level Host**：

- 一台 Device 默认运行一个常驻 Scorel Host。
- 一个 Host 管理本机多个 Project。
- Project 是正式持久化实体，不再从 Session JSONL 临时聚合。
- Session 创建时必须绑定 `projectId`。
- Runtime 创建时通过 `projectId` 解析 Host 持有的 canonical `workDir`。
- CLI embedded 模式仍可用，但它只是临时 Host：启动时注册当前 cwd，仅暴露当前命令需要的 Project。

对外命令和包名继续使用 `daemon`，避免无价值重命名。本文中的 `Host` 表示 daemon 的产品职责升级。

## 背景

S0043 已将多二进制启动路径收敛为单一 `scorel` 入口和 WS daemon，但当前实现仍把 `workDir` 固定在 daemon 构造参数上：

```text
scorel daemon serve --cwd /repo-a
  -> daemon identity = /repo-a
  -> 所有新 session runtime 都运行在 /repo-a
```

这与 GUI、WebUI 和未来 API 的产品模型冲突：

- GUI 需要展示并操作本机多个 Project。
- WebUI 需要在一个已连接 Device 下添加多个远端 Project。
- 新建 Session 应选择 Project，而不是要求用户重新启动 daemon。
- HTTP API 也需要稳定的 `projectId`，不能依赖 daemon 启动 cwd。

继续扩展“一 daemon 一 cwd”会造成严重错误：UI 看起来选中了 Project B，但 Runtime 仍可能在 Project A 的 cwd 中执行工具。

## 领域模型

```typescript
type ProjectId = Brand<string, "ProjectId">;

type HostProject = {
  projectId: ProjectId;
  displayName: string;
  workDir: string;       // canonical absolute path, only authoritative on owning Host
  createdAt: number;
  updatedAt: number;
};

type SessionMeta = {
  projectId: ProjectId;
  title?: string;
  model?: string;
  createdAt?: number;
  updatedAt?: number;
};
```

`projectSlug` 不再承担身份职责。Scorel 当前仍在开发阶段，不保留旧 schema 兼容层。实现 S0048 时直接切换到 `projectId`。

## Host 结构

```text
Device
└── Scorel Host
    ├── DeviceIdentity
    ├── ProjectRegistry          projectId -> canonical workDir
    ├── SessionStore             flat JSONL store
    ├── RuntimePool              sessionId -> projectId -> runtime
    ├── EventHub                 broadcast / dual-seq resync
    ├── ChannelManager
    └── TransportAdapters
        ├── embedded             CLI 临时 Host
        ├── websocket            WebUI / 直接连接
        ├── ssh stdio proxy      GUI 远端连接，后续阶段
        └── HTTP + SSE           纯 API，后续阶段
```

Session JSONL 可以继续放在 `~/.scorel/sessions/` 的 flat 目录中。Project Registry 是独立资产：

```text
~/.scorel/projects.json
```

它记录已添加但还没有 Session 的 Project，因此不能由 JSONL header 聚合替代。

## Project 注册

Project 注册是 Host 能力：

```text
list_directories(path?)
register_project(workDir)
list_projects()
remove_project(projectId)
```

路径由 owning Host 解析、canonicalize 和持久化。Client 不构造 `projectId`，也不根据 slug 反推路径。

`remove_project(projectId)` 只允许移除没有 Session 的 Project。仍有 Session 时必须返回冲突错误，避免 Session 恢复时失去 cwd 映射。成功移除也不得删除工作区文件。

当前产品是可信用户工具。持有 token 或 SSH 凭据即视为拥有该 Device 的完整操作权限：

- 不做细粒度 ACL。
- 不做 `filesystem:browse` 等 capability scopes。
- 不限制目录浏览根路径。
- 仍然禁止日志打印 token、API key 和 SSH secret。

## Entry 语义

### CLI

```text
scorel chat --cwd .
  -> 创建临时 embedded Host
  -> 注册 canonical cwd
  -> 在 projectId 下创建或恢复 Session
```

CLI 的 cwd 是本次打开的 workspace，不是 daemon 身份。

### WebUI

WebUI 只能操作在线 Device：

```text
Add Project
  -> 选择 Device
  -> 浏览该 Host 的目录
  -> register_project(workDir)
```

WebUI 继续以 Device 为第一层组织：

```text
Device -> Project -> Session
```

### GUI

GUI 以 Project 为第一层聚合本地和远端 workspace：

```text
Project -> Session
```

- 本地 Project：系统文件夹选择器 -> local Host `register_project`。
- 远端 Project：选择 SSH Device -> `scorel proxy` -> 浏览目录 -> remote Host `register_project`。

### HTTP API

HTTP 是 Host 的 transport adapter，不是旁路：

```text
POST /projects
POST /projects/:projectId/sessions
POST /sessions/:sessionId/messages
GET  /sessions/:sessionId/events    # SSE
```

HTTP handler 必须调用同一 Host application service，不能直接写 JSONL 或创建 Runtime。

## 远端连接

GUI 后续支持两种远端入口：

1. SSH 默认路径：读取用户 SSH config 或显式连接信息，通过 SSH 执行 `scorel proxy`。
2. Direct WS 高级路径：用户提供已经运行的 Host URL 和 token。

首次 SSH 连接可在用户确认后安装 Scorel 并执行 bootstrap。`scorel proxy` 只是字节桥梁，不拥有 Project、Session 或 Runtime。

## 不做什么

- 不在 S0048/S0049 实现 GUI。
- 不在 S0048/S0049 实现 SSH bootstrap 或 `scorel proxy`。
- 不在 S0048/S0049 实现 HTTP API。
- 不保留 `projectSlug` 兼容字段。
- 不引入 Project worker 子进程；Runtime 仍由单 Host 内部管理。

## 影响

- ADR-002 中“一 daemon 一 Runtime 管理面”的方向保留，但 transport 表格和 Project 语义由本文覆盖。
- ADR-004 中 `apps/daemon` 和 Node socket transport 已被 S0043 删除，由单一 `scorel` CLI + WS daemon 取代。
- `docs/spec/daemon.md` 和 `docs/spec/client.md` 以本文为准更新。
- 首批实现拆为 `S0048` 和 `S0049`。
