# DaemonClient SDK

> 上游：`spec/daemon.md`、`spec/events.md`
> 主题：CLI / GUI / WebUI / HTTP adapter 面向 Device-level Host 的统一客户端。
> 归属包：`@scorel/client`。该包只依赖 `@scorel/protocol`，不得依赖 `@scorel/core` 或 `@scorel/daemon`。

---

## 0. 定位

`DaemonClient` 是 Entry 侧 SDK，不是 Host 的一部分。它负责：

- transport 连接、认证、重连和 request/response correlation
- Device handshake
- Project Registry 操作
- Session 操作
- dual-seq resync、transient buffer 和本地 UI state projection

`@scorel/client` 提供 platform-neutral `DaemonClient` 和 browser-safe `WsTransport`。需要直接持有 Host 实例的 embedded adapter 由 `@scorel/daemon` 提供。

Client 不持有 Runtime，不自行解释工作目录，不从 URL、display name 或路径 slug 反推 project 身份。

---

## 1. 核心接口

```typescript
interface DaemonClient {
  // Connection
  connect(sessionId?: SessionId): Promise<void>;
  disconnect(): void;
  readonly state: "disconnected" | "connecting" | "connected" | "reconnecting";
  readonly sessionId: SessionId | null;
  readonly clientId: ClientId;
  readonly connectionIdentity: {
    deviceId: DeviceId;
    deviceDisplayName?: string;
  } | null;

  // Projects
  listDirectories(path?: string): Promise<DirectoryListing>;
  registerProject(workDir: string): Promise<HostProject>;
  listProjects(): Promise<HostProjectSummary[]>;
  removeProject(projectId: ProjectId): Promise<void>;

  // Sessions
  createSession(input: {
    meta: Omit<SessionMeta, "projectId"> & { projectId: ProjectId };
  }): Promise<SessionId>;
  listSessions(filter?: {
    projectId?: ProjectId;
    limit?: number;
  }): Promise<SessionSummary[]>;
  deleteSession(sessionId: SessionId): Promise<void>;
  switchSession(sessionId: SessionId): Promise<void>;
  cloneSession(fromEventId: EventId, meta?: Partial<SessionMeta>): Promise<SessionId>;
  updateSessionInfo(changes: Partial<SessionMeta>): Promise<EventId>;

  // Conversation
  sendMessage(content: string | ContentBlock[], options?: SendOptions): Promise<{
    userEventId: EventId;
    assistantEventId: EventId;
  }>;
  steer(content: string): void;
  followUp(content: string): void;
  cancel(): Promise<{ sessionId: SessionId; cancelled: boolean }>;
  rewind(targetEventId: EventId): Promise<EventId>;
  branch(leafEventId: EventId): Promise<EventId>;
  compact(): Promise<EventId>;

  // Query and subscription
  getTree(): Promise<PersistentEvent[]>;
  getStatus(): Promise<DaemonStatus>;
  subscribe(handler: (event: ScorelEvent) => void): Unsubscribe;
  on<T extends ScorelEvent["type"]>(
    type: T,
    handler: (event: Extract<ScorelEvent, { type: T }>) => void
  ): Unsubscribe;

  // Recovery
  readonly persistentLastSeq: Seq;
  readonly streamLastSeq: Seq;
  resync(anchors?: {
    persistentLastSeq?: Seq;
    streamLastSeq?: Seq;
  }): Promise<ResyncResult>;

  // Local UI projection
  getLocalState(): ClientSessionState;
  getEvents(): PersistentEvent[];
  getActiveLeaf(): EventId | null;
}
```

`connect()` 可以不带 `sessionId`。此时 Client 只绑定 Device，可执行 Project 和 Session 管理操作；`sendMessage()`、`cancel()`、`resync()` 等会话操作必须先绑定 Session。

---

## 2. Project 操作

### 2.1 身份

`projectId` 是 Host 生成的稳定身份。Client 只把它当 opaque ID。

- `workDir` 是 owning Host 上的 canonical absolute path。
- `displayName` 是 UI label。
- Device URL、SSH host、token 和 `displayName` 都不是 project 身份。
- 不再使用 `projectSlug` 或 `workDirHint`。

```typescript
interface HostProjectSummary {
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

### 2.2 添加 Project

GUI 和 WebUI 的添加流程统一为：

1. 选择 Device。
2. 调用 `listDirectories()` 浏览该 Device 文件系统。
3. 用户选中目录。
4. 调用 `registerProject(workDir)`。
5. Host canonicalize 路径并返回 Project。

本地和远程使用同一套协议。远程 GUI 通过 SSH proxy 接入时，目录浏览仍由远端 Host 完成。

### 2.3 Trusted Full Access

开发阶段默认 Host 拥有本机完整文件访问能力。`listDirectories()` 不做 workspace-root 限制，也不在本轮引入 ACL、scope 或 approval policy。

仍然必须：

- canonicalize path
- 拒绝不存在或不是 directory 的目标
- 不把 token、API key 或 SSH secret 写入日志

---

## 3. Session 操作

每个 Session 必须归属一个 Project：

```typescript
interface SessionMeta {
  projectId: ProjectId;
  title?: string;
  model: string;
  thinkingLevel: "none" | "low" | "medium" | "high";
}
```

`createSession()` 只接受已注册 `projectId`。Host 根据 Registry 解析 canonical `workDir`，再创建 project-aware Runtime。Client 不允许直接覆盖 `cwd`。

`listSessions({ projectId })` 返回目标 Project 下的 Session；省略过滤器时返回当前 Device 的全部 Session。

---

## 4. 本地状态和恢复

DaemonClient 内部维护：

- `events`：最近一次 resync 以来的 PersistentEvent 列表
- `tree projection`：只读 UI 投影，不是 core 的权威 SessionTree
- `activeLeaf`：当前 active 叶子
- `transient buffer`：从 `message_start` 到对应 PersistentEvent 之间的 delta

Client 不实现 `buildContext`。LLM context 构建属于 `@scorel/core/session`。

### 4.1 Dual-Seq

Client 保存两个恢复锚点：

- `persistentLastSeq`：已经持久化、进程重启后仍可渲染的最高 seq
- `streamLastSeq`：实时流中已经观察到的最高 seq

`resync()` 显式返回：

- `stream_resume`：ring buffer 连续覆盖 `streamLastSeq + 1`
- `persistent_fallback`：无法证明 transient 连续性，只补 persistent events
- `full_reload`：本地缓存不兼容，重新加载 Host 权威状态

### 4.2 Attach Cache

远程 attach cache 身份来自 Host metadata，不来自 URL：

```text
remote + deviceId + projectId + sessionId
```

URL 只是 transport locator。相同 Device 和 Project 改用另一个 URL 后，应复用同一份缓存。

```text
~/.scorel/attach-cache/{scopeKey}/{sessionId}.json
~/.scorel/attach-cache/{scopeKey}/{sessionId}.log
```

attach diagnostics 记录连接生命周期、身份解析、cache read/write、resync anchors、恢复模式、事件摘要和 outbound sends。不得记录 token、API key、SSH secret、完整 prompt 或完整 tool result。

---

## 5. Transport

当前产品路径：

```typescript
// CLI local
const transport = createEmbeddedTransport(host);

// WebUI and direct remote control
const transport = new WsTransport({ url, token });
```

未来新增 adapter：

```typescript
// GUI-managed remote device
const transport = await createSshProxyTransport(sshConfig);

// Pure HTTP integration
const client = new HttpScorelClient({ baseUrl, token });
```

规则：

- Embedded 和 WebSocket 是当前已实现 transport。
- GUI 默认通过 SSH 启动或连接远端 Scorel，再使用 stdio proxy 转发协议。
- 已经部署好的 Host 可作为高级入口直接使用 WS URL + token。
- HTTP API 是独立 adapter：命令走 HTTP request，事件走 SSE。它映射同一 Host use cases，不复制业务逻辑。
- 不恢复 Unix socket transport；S0043 已删除该产品路径。

---

## 6. UI 组织方式

WebUI 只能联机，采用 Device-first：

```text
Device
  └── Project
        └── Session
```

GUI 同时管理本地和远程环境，采用 Project-first：

```text
Project
  ├── Local Device
  └── Remote Device
```

两种视图都只使用同一组 Host API。区别只是入口和信息架构，不是后端模型分叉。

---

## 7. Pre-1.0 切换规则

S0048 实现时直接删除旧兼容面：

- 删除 `projectSlug`、`workDirHint` wire/schema。
- 删除 attach cache 和 WebUI local storage 的旧 key。
- 删除从 Session JSONL 聚合 Project 的旧逻辑。
- bump `protocolVersion`，旧 Client 明确失败。

不做 alias、dual-write、迁移脚本或 silent fallback。

---

*DaemonClient 是所有 Entry 面向 Host 的统一接口。不同产品入口只替换 transport 和视图组织方式。*
