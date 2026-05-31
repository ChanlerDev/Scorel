# Daemon Host - Device-level Runtime And Project Coordination

> 上游：`architecture.md`、`decisions/006-device-host-project-registry.md`、`spec/events.md`、`spec/runtime.md`
> 归属包：`@scorel/daemon`

---

## 0. 定位

Scorel daemon 是 **Device-level Host**：

- 一台 Device 默认运行一个 Host。
- 一个 Host 管理多个 Project。
- Host 是 Runtime 和 Session JSONL 的唯一持有者与写入者。
- CLI、WebUI、GUI、IM 和未来 HTTP API 都不能绕过 Host。

对外命令和包名继续使用 `daemon`。代码实现可将当前 `EmbeddedDaemon` 重命名为 `ScorelHost`，避免继续暗示“一 daemon 一 cwd”。

---

## 1. 不变量

1. Host 身份是 `deviceId`，不是 cwd。
2. Project 是正式实体，持久化到 `~/.scorel/projects.json`。
3. 每个 Project 有 Host 生成的稳定 `projectId`。
4. 每个 Session header 必须持久化 `projectId`。
5. Runtime 创建时必须通过 `session.meta.projectId` 查询 Registry，再取得 canonical `workDir`。
6. Project 可以没有 Session；因此 `list_projects` 不得由 Session JSONL 聚合替代。
7. Session JSONL 只有 Host 可以写。
8. PersistentEvent 与 TransientEvent 共用 per-session seq。
9. 当前 pre-1.0 不保留 `projectSlug`、`workDirHint` 或旧本地状态兼容层。

关键验收：

```text
Project A -> Session A -> Runtime cwd A
Project B -> Session B -> Runtime cwd B
```

同一 Host 下两个 Session 必须能在两个不同真实仓库中执行工具，不能串 cwd。

---

## 2. 领域模型

### 2.1 IDs

```typescript
type ProjectId = Brand<string, "ProjectId">;
```

### 2.2 Project

```typescript
type HostProject = {
  projectId: ProjectId;
  displayName: string;
  workDir: string;       // canonical absolute path
  createdAt: number;
  updatedAt: number;
};
```

规则：

- `projectId` 由 Host 生成，例如 `prj_<uuid>`。
- `workDir` 在注册时 canonicalize，并由 owning Host 持久化。
- 相同 canonical `workDir` 重复注册必须返回已有 Project，不能创建重复项。
- `displayName` 默认取 `basename(workDir)`，以后可允许重命名。
- 删除 Project 不自动删除 Session JSONL；S0048 只允许删除没有 Session 的 Project，避免隐式数据删除。

### 2.3 Session Meta

```typescript
type SessionMeta = {
  projectId: ProjectId;
  title?: string;
  model?: string;
  createdAt?: number;
  updatedAt?: number;
};
```

`projectId` 是 Session 与 Runtime cwd 的唯一绑定。不得允许 client 提交 cwd 作为 `create_session` 的旁路参数。

---

## 3. Host 结构

```text
ScorelHost
├── DeviceIdentity
├── ProjectRegistry
├── SessionStore
├── RuntimePool
├── EventHub
├── ConnectionManager
├── ChannelManager
└── TransportAdapters
```

### 3.1 ProjectRegistry

持久化：

```text
~/.scorel/projects.json
```

文件形态：

```typescript
type ProjectRegistryFile = {
  version: 1;
  projects: HostProject[];
};
```

API：

```typescript
interface ProjectRegistry {
  list(): Promise<HostProject[]>;
  get(projectId: ProjectId): Promise<HostProject | undefined>;
  require(projectId: ProjectId): Promise<HostProject>;
  register(workDir: string): Promise<HostProject>;
  remove(projectId: ProjectId): Promise<void>;
}
```

### 3.2 RuntimePool

每个活跃 Session 最多一个 Runtime：

```typescript
type SessionLane = {
  session: JsonlSession;
  project: HostProject;
  runtime: ScorelRuntime;
  queue: Promise<unknown>;
};
```

Runtime factory 改为 project-aware：

```typescript
type RuntimeFactory = (input: {
  sessionId: SessionId;
  project: HostProject;
}) => Promise<ScorelRuntime>;
```

真实 runtime 创建流程：

```text
project.workDir
  -> loadScorelConfig({ cwd: project.workDir })
  -> createCodingTools({ cwd: project.workDir })
  -> createPiAiProvider(...)
  -> ScorelRuntime
```

### 3.3 SessionStore

继续使用 flat 目录：

```text
~/.scorel/sessions/<sessionId>.jsonl
~/.scorel/sessions/<sessionId>.log
```

不需要把文件搬入 Project 子目录。Session header 中的 `projectId` 足以索引归属。

### 3.4 EventHub

- per-session seq。
- PersistentEvent 写 JSONL 后广播。
- TransientEvent 只广播并进入 live buffer。
- reconnect 使用 dual-seq：
  - `stream_resume`
  - `persistent_fallback`
  - `full_reload`

---

## 4. Host API

```typescript
interface ScorelHost {
  start(): Promise<void>;
  shutdown(): Promise<void>;

  listDirectories(path?: string): Promise<DirectoryListing>;
  registerProject(workDir: string): Promise<HostProject>;
  listProjects(): Promise<HostProjectSummary[]>;
  removeProject(projectId: ProjectId): Promise<void>;

  createSession(meta: SessionMeta): Promise<SessionId>;
  loadSession(sessionId: SessionId): Promise<SessionLane>;
  getRuntime(sessionId: SessionId): ScorelRuntime | undefined;
}

type DirectoryEntry = {
  name: string;
  path: string;
};

type DirectoryListing = {
  currentPath: string;
  parentPath?: string;
  entries: DirectoryEntry[];
};

type HostProjectSummary = {
  projectId: ProjectId;
  displayName: string;
  workDir: string;
  sessionCount: number;
  lastSeenAt?: number;
};
```

当前可信用户模型允许完整目录浏览。`listDirectories()` 不做 ACL 或根目录限制，但必须：

- 只返回目录，不返回文件内容。
- 对不存在、无权限、非目录路径返回结构化错误。
- 使用 canonical absolute path。
- 稳定排序：目录名 locale compare。

---

## 5. Wire Protocol

### 5.1 Project 请求

```typescript
type ClientRequestMap = {
  list_directories: {
    request: { path?: string };
    response: { currentPath: string; parentPath?: string; entries: DirectoryEntry[] };
  };
  register_project: {
    request: { workDir: string };
    response: { project: HostProjectSummary };
  };
  list_projects: {
    request: {};
    response: { projects: HostProjectSummary[] };
  };
  remove_project: {
    request: { projectId: ProjectId };
    response: { projectId: ProjectId; removed: boolean };
  };
};
```

### 5.2 Session 请求

```typescript
type ClientRequestMap = {
  create_session: {
    request: {
      sessionId?: SessionId;
      meta: { projectId: ProjectId; title?: string; model?: string };
    };
    response: { sessionId: SessionId };
  };
  list_sessions: {
    request: { projectId?: ProjectId; limit?: number };
    response: { sessions: SessionSummary[] };
  };
};
```

`create_session` 必须拒绝：

- 缺少 `projectId`。
- `projectId` 不存在。
- client 试图直接提交 cwd。

### 5.3 Connection Identity

Handshake 只报告 Device 身份：

```typescript
type ConnectResult = {
  clientId: ClientId;
  sessionId?: SessionId;
  currentSeq?: Seq;
  deviceId: DeviceId;
  deviceDisplayName?: string;
};
```

Project 不属于 connection identity。Client 通过 `list_projects` 获取 Project 列表。

---

## 6. Transport

| Transport | 状态 | 场景 |
|---|---|---|
| Embedded | 已有 | `scorel chat` 临时 Host |
| WebSocket | 已有 | `scorel daemon serve`、WebUI、Direct WS |
| SSH stdio proxy | 后续 | GUI 远端 Device |
| HTTP + SSE | 后续 | 纯 API |

S0043 已删除 Unix socket transport。不要重新引入旧 socket 路径作为兼容层。

### 6.1 SSH Proxy 边界

后续 `scorel proxy`：

- 通过 SSH stdio 转发到远端 Host control endpoint。
- 不持有 Project。
- 不持有 Session。
- 不创建 Runtime。
- 不复制业务协议。

### 6.2 HTTP 边界

后续 HTTP adapter：

- REST 负责 command。
- SSE 负责 event stream。
- handler 调用同一 Host application service。
- 不直接读写 JSONL。

---

## 7. Entry 场景

### 7.1 CLI Embedded

```text
scorel chat --cwd /repo
  -> create temporary Host
  -> registry.register(/repo)
  -> createSession({ projectId })
  -> DaemonClient over EmbeddedTransport
```

### 7.2 Local WebUI

```text
scorel up
  -> persistent WS Host
  -> WebUI detects local Device
  -> Add Project
  -> listDirectories + registerProject
```

### 7.3 Remote WebUI

```text
WebUI
  -> connect Device URL + token
  -> Add Project
  -> browse remote Host directories
  -> registerProject
```

### 7.4 GUI

```text
Local Folder Picker
  -> local Host.registerProject

SSH Device
  -> scorel proxy
  -> remote Host.listDirectories
  -> remote Host.registerProject
```

---

## 8. Diagnostics

每个 Session 保留同目录 `.log`：

```text
~/.scorel/sessions/<sessionId>.log
```

需要记录：

- `project_registered`
- `project_removed`
- `session_created` + `projectId`
- `session_loaded` + `projectId`
- `runtime_created` + `projectId` + `workDir`
- connect/disconnect
- resync mode
- provider/runtime errors

不得记录 token、API key、SSH password 或私钥内容。

---

## 9. 开发期破坏性重构

S0048 直接执行：

- 删除 `projectSlug` 和 `workDirHint` wire/schema。
- 删除 Session header 中旧 Project 字段。
- 删除从 JSONL 聚合 Project 的 `ProjectAggregator`。
- `protocolVersion` 增加。
- 本地开发环境需要清理旧 `~/.scorel/project-index.json`、旧 Session JSONL、旧 attach cache 和浏览器 localStorage。新的 `~/.scorel/projects.json` 由 Registry 创建。

不写迁移器，不保留 fallback。

---

*Host 的职责不是守住一个 cwd，而是守住一台 Device 上的 Project、Session 和 Runtime 一致性。*
