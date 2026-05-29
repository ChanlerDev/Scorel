# DaemonClient SDK

> 上游：`spec/daemon.md`、`spec/events.md`
> 主题：Client 侧统一接口。CLI / GUI / WebUI 都用同一个类，只是传入不同的 transport。
> 归属包：`@scorel/client`。该包只依赖 `@scorel/protocol`，不得依赖 `@scorel/core` 或 `@scorel/daemon`。

---

## 0. 包边界

DaemonClient 是 Entry 侧 SDK，不是 Daemon 的一部分。它负责连接、重连、request/response、`lastSeq` resync、transient buffer 和本地 UI state projection。

`@scorel/client` 提供 platform-neutral `DaemonClient`、browser-safe `WsTransport`、Node socket transport（subpath export）。需要直接持有 Daemon 实例的 embedded adapter 由 `@scorel/daemon` 提供，因为它必须接触 Daemon 内部对象，不能放进 browser-safe client 包。

---

## 1. 核心接口

```typescript
interface DaemonClient {
  // ─── 连接 ───
  connect(sessionId: SessionId): Promise<void>;
  disconnect(): void;
  readonly state: "disconnected" | "connecting" | "connected" | "reconnecting";
  readonly sessionId: SessionId | null;
  readonly clientId: ClientId;

  // ─── 对话操作 ───
  sendMessage(content: string | ContentBlock[], options?: SendOptions): Promise<{
    userEventId: EventId;
    assistantEventId: EventId;  // 预分配的 assistant 消息 id
  }>;
  steer(content: string): void;   // 运行中插话，fire-and-forget
  followUp(content: string): void; // 追加任务（agent 停下后消费）
  cancel(): Promise<void>;

  // ─── 树操作 ───
  rewind(targetEventId: EventId): Promise<EventId>;
  branch(leafEventId: EventId): Promise<EventId>;
  compact(): Promise<EventId>;

  // ─── Session 管理 ───
  createSession(meta: Partial<SessionMeta>): Promise<SessionId>;
  listSessions(): Promise<SessionSummary[]>;
  deleteSession(sessionId: SessionId): Promise<void>;
  switchSession(sessionId: SessionId): Promise<void>;
  cloneSession(fromEventId: EventId, meta?: Partial<SessionMeta>): Promise<SessionId>;
  updateSessionInfo(changes: Partial<SessionMeta>): Promise<EventId>;

  // ─── 查询 ───
  getTree(): Promise<PersistentEvent[]>;   // 完整 session 树
  getStatus(): Promise<DaemonStatus>;      // runtime 状态

  // ─── 事件订阅 ───
  subscribe(handler: (event: ScorelEvent) => void): Unsubscribe;
  on<T extends ScorelEvent["type"]>(
    type: T,
    handler: (event: Extract<ScorelEvent, { type: T }>) => void
  ): Unsubscribe;

  // ─── 同步 ───
  readonly lastSeq: Seq;
  resync(fromSeq?: Seq): Promise<void>;

  // ─── 本地 UI 状态（从收到的事件投影）───
  getLocalState(): ClientSessionState;
  getEvents(): PersistentEvent[];
  getActiveLeaf(): EventId | null;
}

interface DaemonStatus {
  running: boolean;          // runtime 是否在执行 turn
  model: string;
  activeClients: ClientId[];
  sessionCount: number;
  uptime: number;
}

interface ClientSessionState {
  sessionId: SessionId;
  events: PersistentEvent[];
  activeLeafId: EventId | null;
  transients: TransientMessage[];
}

interface TransientMessage {
  eventId: EventId;
  role: "assistant";
  content: ContentBlock[];
  partial: true;
}
```

---

## 2. 使用示例

```typescript
// CLI 使用（embedded transport）
const daemon = await createEmbeddedDaemon(config);
const transport = createEmbeddedTransport(daemon); // from @scorel/daemon/embedded
const client = new DaemonClient(transport, { clientId: "cli-local-001" });

await client.connect(sessionId);

client.on("text_delta", (e) => process.stdout.write(e.delta));
client.on("message", (e) => {
  if (e.message.role === "assistant") {
    process.stdout.write("\n");
  }
});

await client.sendMessage("解释 monads");
```

---

## 3. 连接状态机

```
disconnected → connecting → connected ⇄ reconnecting
                    ↓                         ↓
              auth_failed              disconnected（重试耗尽）
```

- `connecting`：正在进行 transport 连接 + auth 验证
- `connected`：正常工作状态
- `reconnecting`：transport 断开后自动重试中（lastSeq 保留用于补发）
- `disconnected`：显式 disconnect 或重试耗尽

---

## 4. 本地状态管理

DaemonClient 内部维护从收到的事件投影出的本地 UI 状态：

- **events**：最近一次 resync 以来的 PersistentEvent 列表
- **tree projection**：可选的只读 UI 投影，用于展示分支结构，不等同于 core 的 SessionTree
- **activeLeaf**：当前 active 叶子节点
- **transient buffer**：从 `message_start` 到对应 PersistentEvent 之间的 delta 累积

当收到 PersistentEvent(MessageEvent) 时，用 `id` 匹配替换对应 transient buffer → UI 从流式渲染过渡到完整消息。

DaemonClient 不实现 `buildContext`。LLM context 构建属于 `@scorel/core/session`，由 daemon 在执行 turn 前调用。Client 侧的 tree projection 只服务 UI 展示，不能成为调度、压缩或 rewind 判断的权威来源。

---

## 5. Transport 选择

```typescript
// Embedded（由 @scorel/daemon/embedded 提供）
const transport = createEmbeddedTransport(daemon);

// Local socket（@scorel/client/node）
const transport = new SocketTransport("/tmp/scorel.sock");

// Remote WebSocket（@scorel/client）
const transport = new WsTransport({ url: "wss://vps:18789", token: "sk-xxx" });

// 统一使用
const client = new DaemonClient(transport, { clientId });
```

DaemonClient 代码完全相同，transport 是唯一差异点。Transport 的具体实现可以来自 `@scorel/client` 或 `@scorel/daemon/embedded`，但都实现同一个 `DaemonTransport` protocol interface。

### 5.1 Remote WebSocket

Remote control uses the root `@scorel/client` export:

```typescript
const client = new DaemonClient(
  new WsTransport({ url: "ws://remote-host:18789", token }),
  { clientId }
);

await client.connect(sessionId);
await client.resync(lastSeq);
```

Rules:

- Token auth is bearer-token style and belongs to the transport handshake.
- `@scorel/client` does not persist tokens.
- Reconnect keeps the client-side `lastSeq`; the client reconnects to the same session and calls `resync_events`.
- Auth failure is surfaced as a concise connection error.
- The same `DaemonClient` API is used for embedded, local socket, and remote WebSocket modes.

---

*DaemonClient 是所有 Entry 面对 Daemon 的唯一接口。不同的只是传入的 transport。*
