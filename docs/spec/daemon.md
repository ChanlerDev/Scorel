# Daemon — 运行时持有与多端协调

> 上游：`architecture.md`、`spec/events.md`、`spec/runtime.md`
> 主题：Daemon 是 Runtime 和 Session 的唯一持有者，负责多 client 广播、重连同步、并发控制、部署灵活性。
> 归属包：`@scorel/daemon`。Daemon 依赖 `@scorel/core` 和 `@scorel/protocol`，不得依赖 `@scorel/client` 或 `apps/*`。

---

## 0. 包边界

Daemon 是 Runtime 的上层管理面，不是 App，也不是 Client SDK。它负责持有 runtime/session、串行化写操作、分配 seq、广播事件、auth、server transport 和 channel 生命周期。

Apps 可以启动、管理、连接 Daemon，但不能绕过 Daemon 直接写 Session 或直接持有 Runtime。`@scorel/daemon` 可以提供 embedded host / embedded transport adapter，供 CLI/GUI 本地模式使用；`@scorel/client` 只消费 protocol-level transport interface，不反向依赖 Daemon。

---

## 1. 设计目标

Daemon 解决一个核心问题：**多个 Entry 共享同一个 Agent 的运行状态和对话历史**。

具体要求：

1. **唯一写入者**：Session JSONL 只有 Daemon 能写，消除并发竞争
2. **实时广播**：任何 Entry 的操作产生的 event，所有已连接 client 都能收到
3. **断线续传**：client 断开后重连，能补发 missed events，不丢上下文
4. **部署灵活**：同一套协议支持进程内嵌入、本地独立进程、远端网络三种模式
5. **并发安全**：多 client 同时操作同一 session 不会产生冲突

---

## 2. 内部结构

```
Daemon
  ├── DaemonServer
  │     ├── ConnectionManager（client 连接池、auth 验证）
  │     ├── EventBroadcaster（带 seq 的事件广播 + 环形缓冲）
  │     └── MessageRouter（指令分发 → session lane）
  ├── ChannelManager（非交互式输入源，详见 spec/channels.md）
  │     ├── TelegramChannel
  │     ├── CronChannel
  │     └── ...
  ├── RuntimePool（多 runtime 管理，每个 session 一个）
  │     ├── RuntimeBridge[ses_abc] → ScorelRuntime
  │     ├── RuntimeBridge[ses_def] → ScorelRuntime
  │     └── ...
  ├── SessionStore（JSONL 读写，唯一 writer）
  └── ExtensionRunner（扩展生命周期）
```

**Runtime 模型**：一个 daemon 可运行多个 runtime，每个 runtime 服务一个 session（1:1）。多终端并发操作不同 session = 多个 runtime 同时在跑。同一 session 的多个 client 共享一个 runtime，通过 SessionLane 串行化写操作。

---

## 3. DaemonTransport：统一传输抽象

```typescript
/**
 * Client 侧传输接口。三种实现共用同一个 interface。
 */
interface DaemonTransport {
  send(msg: ClientMessage): void;
  onEvent(cb: (event: DaemonEvent) => void): () => void;
  connect(params: ConnectParams): Promise<ConnectResult>;
  close(): void;
}

interface ConnectParams {
  auth?: AuthToken;
  device: DeviceInfo;
  lastSeq?: number;   // 重连时提供，用于补发 missed events
}

interface ConnectResult {
  sessionId: string;
  config: RuntimeInfo;
  missedEvents?: DaemonEvent[];  // lastSeq 到当前的补发
}
```

### 3.1 三种实现

| Transport | 实现 | 安全模型 | 适用场景 |
|---|---|---|---|
| `EmbeddedTransport` | 同进程直接方法调用 | 无需（进程内） | CLI/GUI 单用户，Daemon 随进程生死 |
| `SocketTransport` | Unix socket / Named pipe | 文件系统权限 | 本地多 Entry 共享，Daemon 独立后台进程 |
| `WsTransport` | WebSocket over TCP/TLS | TLS + token auth | 远端 VPS / 手机遥控 / 浏览器 WebUI |

三者共享 `DaemonTransport` interface，Client 代码不感知差异。但实现独立——安全模型、错误处理、重连策略各不相同。

**为什么不合并 Socket + WS：**
- 安全模型完全不同（文件权限 vs TLS + token）
- 浏览器只能用 WS（不能连 Unix socket）
- 错误模式不同（本地文件 vs 网络超时/DNS）
- 重连策略不同（本地 = 简单重试，网络 = 指数退避）
- 合并只是 URL scheme 分支，表面统一实际更复杂

### 3.2 EmbeddedTransport（零开销模式）

```typescript
class EmbeddedTransport implements DaemonTransport {
  private daemon: Daemon;

  send(msg: ClientMessage): void {
    // 直接调用 daemon 方法，无序列化
    this.daemon.handleMessage(this.clientId, msg);
  }

  onEvent(cb: (event: DaemonEvent) => void): () => void {
    return this.daemon.subscribe(this.clientId, cb);
  }
}
```

用户运行 `scorel chat` 时：CLI 进程内 `new Daemon()` + `new EmbeddedTransport(daemon)` + `new DaemonClient(transport)`。整条链路零 IPC，体验等同原来的"直接持有 Runtime"。

包归属：`EmbeddedTransport` 由 `@scorel/daemon/embedded` 提供；`DaemonClient` 来自 `@scorel/client`。这样可以保持 browser-safe client 包不依赖 Daemon。

---

## 4. Daemon 内部 API

### 4.1 主结构

```typescript
interface Daemon {
  start(): Promise<void>;
  shutdown(): Promise<void>;

  // Session 管理
  getOrLoadSession(sessionId: SessionId): Promise<SessionLane>;
  createSession(meta: SessionMeta, deviceId: DeviceId): Promise<SessionLane>;

  // 组件
  readonly connections: ConnectionManager;
  readonly broadcaster: EventBroadcaster;

  // Runtime
  attachRuntime(sessionId: SessionId): RuntimeBridge;
  getRuntime(sessionId: SessionId): RuntimeBridge | undefined;
}
```

### 4.2 EventBroadcaster

```typescript
interface EventBroadcaster {
  /** 分配 seq 并广播给所有该 session 的 client */
  broadcast(sessionId: SessionId, event: Omit<ScorelEvent, "seq">): ScorelEvent;

  /** 重连同步：返回 seq 之后的事件 */
  getEventsAfter(sessionId: SessionId, afterSeq: Seq): ScorelEvent[];

  /** 当前最新 seq */
  getCurrentSeq(sessionId: SessionId): Seq;
}
```

### 4.3 SessionLane

```typescript
interface SessionLane {
  readonly sessionId: SessionId;
  readonly tree: SessionTree;
  readonly activeLeafId: EventId | null;

  /** 追加事件（parentId 默认 = activeLeaf，自动更新 activeLeaf） */
  append(event: Omit<PersistentEvent, "seq" | "parentId"> & { parentId?: EventId | null }): Promise<PersistentEvent>;

  /** 在指定位置追加（用于分支场景） */
  appendAt(parentId: EventId | null, event: Omit<PersistentEvent, "seq" | "parentId">): Promise<PersistentEvent>;

  /** 移动 active leaf（rewind/branch 后） */
  setActiveLeaf(eventId: EventId): void;

  /** 从 JSONL 重加载 */
  loadAllEvents(): AsyncIterable<PersistentEvent>;
}
```

---

## 5. 线协议（Client ↔ Daemon）

### 5.1 Client → Daemon

```typescript
type ClientMessage =
  // ─── 连接生命周期 ───
  | { type: "connect"; sessionId: SessionId; clientId: ClientId; lastSeq?: Seq; token: string }
  | { type: "disconnect" }
  | { type: "ping" }

  // ─── 对话操作 ───
  | { type: "send_message"; requestId: string; content: string | ContentBlock[]; options?: SendOptions }
  | { type: "steer"; requestId: string; content: string }  // 运行中插话，不排队新 turn
  | { type: "cancel"; requestId: string }

  // ─── 树操作 ───
  | { type: "rewind"; requestId: string; targetEventId: EventId; expectedLeafId: EventId }
  | { type: "branch"; requestId: string; leafEventId: EventId }
  | { type: "compact"; requestId: string }

  // ─── Session 管理 ───
  | { type: "create_session"; requestId: string; meta: Partial<SessionMeta> }
  | { type: "list_sessions"; requestId: string }
  | { type: "delete_session"; requestId: string; sessionId: SessionId }
  | { type: "switch_session"; requestId: string; sessionId: SessionId; lastSeq?: Seq }
  | { type: "clone_session"; requestId: string; fromEventId: EventId; meta?: Partial<SessionMeta> }
  | { type: "get_tree"; requestId: string }  // 获取完整 session 树（首次连接/UI 需要）

  // ─── 配置与状态 ───
  | { type: "update_info"; requestId: string; changes: Partial<SessionMeta> }
  | { type: "get_status"; requestId: string }  // daemon 状态：runtime running、model、active clients

  // ─── 同步 ───
  | { type: "resync"; requestId: string; fromSeq?: Seq };
```

**说明**：

| 消息 | 用途 |
|------|------|
| `connect` | 首次连接，携带 token 认证 + clientId + 要连接的 session |
| `disconnect` | 优雅断开 |
| `ping` | 心跳保活，daemon 回 `pong` |
| `send_message` | 发送用户消息，触发新 turn |
| `steer` | 运行中插话（注入 steeringQueue，不排队等当前 turn 完成） |
| `cancel` | 中断当前生成 |
| `rewind` | 回退到某个 event，带乐观锁 |
| `branch` | 切换到已有分支的某个叶子 |
| `compact` | 触发上下文压缩 |
| `create_session` | 创建新 session |
| `list_sessions` | 列出 daemon 上所有 sessions |
| `delete_session` | 删除 session |
| `switch_session` | 切换到另一个 session（同一 daemon 上） |
| `clone_session` | 从某个 event clone 出新 session（跨 device 复制时产生独立 session） |
| `get_tree` | 获取完整 session 树结构（含所有 PersistentEvent） |
| `update_info` | 修改 session 元数据（model、name 等） |
| `get_status` | 查询 daemon 运行状态 |
| `resync` | 重连时请求补发 missed events |

### 5.2 Daemon → Client

```typescript
type DaemonMessage =
  // ─── 连接响应 ───
  | { type: "connected"; sessionId: SessionId; activeLeafId: EventId | null; currentSeq: Seq; meta: SessionMeta }
  | { type: "disconnected"; reason: string }
  | { type: "pong" }
  | { type: "auth_failed"; reason: string }

  // ─── 事件广播（核心）───
  | { type: "event"; event: ScorelEvent }

  // ─── 请求响应 ───
  | { type: "response"; requestId: string; ok: true; data?: unknown }
  | { type: "error"; requestId: string; ok: false; code: ErrorCode; message: string }

  // ─── 同步 ───
  | { type: "sync_start"; fromSeq: Seq; count: number }
  | { type: "sync_end"; throughSeq: Seq }

  // ─── 通知（daemon 主动推送）───
  | { type: "client_joined"; clientId: ClientId }
  | { type: "client_left"; clientId: ClientId }
  | { type: "session_switched"; sessionId: SessionId; activeLeafId: EventId | null; currentSeq: Seq };

type ErrorCode =
  | "auth_failed"        // token 错误
  | "session_not_found"  // session 不存在
  | "runtime_busy"       // 有 client 正在 prompt
  | "conflict"           // 乐观锁冲突（rewind 时 leaf 已变）
  | "invalid_event_id"   // 引用了不存在的 eventId
  | "invalid_request"    // 消息格式错误
  | "internal_error";    // daemon 内部错误
```

---

## 6. 事件广播 + 重连同步

### 6.1 Seq 序号

每个 session 独立维护递增 `seq`（uint64，从 1 开始）。PersistentEvent 和 TransientEvent 共享同一个 per-session seq 序列。

> **变更记录**：原设计为 Daemon 进程级全局 seq。ADR-003 改为 per-session，避免多 session 并发时快速消耗缓冲、session 切换时 lastSeq 语义混乱。

### 6.2 环形缓冲

Per-active-session，字节上限（默认 2MB）。FIFO 淘汰。

```typescript
class SessionEventBuffer {
  private buffer: RingBuffer<DaemonEvent>;
  private maxBytes: number = 2 * 1024 * 1024;  // 2MB
  private currentBytes: number = 0;
  private seq: number = 0;

  push(event: ScorelEvent): DaemonEvent {
    this.seq += 1;
    const daemonEvent = { ...event, seq: this.seq };
    const eventSize = estimateSize(daemonEvent);

    // 淘汰旧事件直到有空间
    while (this.currentBytes + eventSize > this.maxBytes && !this.buffer.isEmpty()) {
      const evicted = this.buffer.shift();
      this.currentBytes -= estimateSize(evicted);
    }

    this.buffer.push(daemonEvent);
    this.currentBytes += eventSize;
    return daemonEvent;
  }

  // Client 重连时调用
  getAfter(lastSeq: number): DaemonEvent[] | null {
    const oldest = this.buffer.oldestSeq();
    if (oldest === null || lastSeq < oldest) {
      return null;  // 缓冲不够，需要 JSONL fallback
    }
    return this.buffer.filter(e => e.seq > lastSeq);
  }
}
```

> **变更记录**：原设计为全局共享 RingBuffer 固定 1000 条。ADR-003 改为 per-session + 字节上限。

### 6.3 重连同步（三级 fallback）

```
Client 断线 → 重连 →
  connect({ sessionId, lastSeq: 42 })
    ↓
  Daemon 同步逻辑:
    1. 检查 session buffer:
       - 42 在缓冲范围内 → 补发所有 seq > 42 的事件（persistent + transient）
       - 缓冲不够 →
    2. 从 JSONL 补发 seq > 42 的 PersistentEvent（transient 丢失不影响正确性）
    3. 如果 runtime 正在生成 →
       补发 message_start { eventId, partial: "已累积文本" }
       → Client 从此刻起正常收后续 delta
```

### 6.4 同步示例

```
Client 断线前 lastSeq = 5
中间发生了: seq 6(transient), 7(persistent), 8(transient), 9(persistent), 10(transient)

Client 重连:
  → connect(lastSeq: 5)
  ← sync_start
  ← event(seq:6)  transient  (如果还在环形缓冲中)
  ← event(seq:7)  persistent (从 JSONL 或缓冲)
  ← event(seq:8)  transient
  ← event(seq:9)  persistent
  ← event(seq:10) transient
  ← sync_end
```

### 6.5 全量 Replay 降级

当缓冲不够时，client 走 `get_tree` 拿完整 JSONL replay 结果，等同新连接。开销大但正确。

### 6.6 Rewind 如何同步

```
Client A 执行 rewind:

1. Client A → Daemon: rewind(targetEventId: "e01", expectedLeafId: "e03")
2. Daemon SessionLane:
   - 验证 expectedLeafId == 当前 activeLeaf（乐观锁）
   - 创建 RewindEvent { id: "e04", parentId: "e03", targetEventId: "e01" }
   - 写入 JSONL
   - 更新 activeLeaf → "e01"
   - 分配 seq，广播
3. Daemon → All Clients: event { type: "rewind", ... seq: N }
4. Client B 收到 rewind event:
   - 更新本地树
   - activeLeaf 变为 "e01"
   - UI 刷新显示
```

---

## 7. 并发控制

### 7.1 Session Lane（串行化）

同一 session 的所有写操作（prompt / steer / rewind / branch）进入 session lane 排队，串行执行。

```typescript
class SessionLane {
  private queue: AsyncQueue<LaneTask>;
  private running = false;

  async enqueue(task: LaneTask): Promise<void> {
    if (this.running && task.method === "prompt") {
      // 已有 prompt 在跑，新 prompt 排队
      // 通知 client "busy"
      task.client.send({ type: "busy", seq: this.seq++, queuePosition: this.queue.size });
    }
    this.queue.push(task);
    this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (!this.queue.isEmpty()) {
      const task = this.queue.shift();
      await this.execute(task);
    }
    this.running = false;
  }
}
```

### 7.2 多 Client 同时操作规则

| 场景 | 行为 |
|---|---|
| Client A prompt，Client B prompt | B 收到 `busy`，排队等 A 完成 |
| Client A prompt，Client B steer | B 的 steer 正常进入 steeringQueue |
| Client A prompt，Client B abort | 立即中断（abort 不排队） |
| Client A prompt，Client B rewind | B 收到 `busy`，等 A 完成后再 rewind |

### 7.3 并发 rewind

- Client A rewind → 到达 SessionLane
- Client B rewind → 排队
- A 执行成功 → activeLeaf 变了
- B 执行时 `expectedLeafId != activeLeaf` → 返回 conflict 错误
- Client B 刷新状态后可重试

### 7.4 多设备同 session

- Device A 正在生成 → runtime busy
- Device B 发消息 → Daemon 返回 `runtime_busy` 错误
- Device B 可以：浏览历史、切换分支、查看实时流式输出
- Device B 不能：prompt（必须等 A 完成或 cancel）

### 7.5 后期：Global Lane

多 session 并发时限流（如 VPS 上同时跑 3 个 session）。初期不需要，单 session 够用。

---

## 8. Auth

### 8.1 统一模型

**所有 Daemon 都暴露 uri + token**。无论 embedded / socket / remote，连接方式统一：

```
Daemon 启动 → 生成 token → 暴露 uri
Client 连接 → 提供 uri + token → 验证通过 → 建立连接
```

没有"本地无 auth"的特例。Embedded 模式下 token 在进程内传递（无网络暴露），但协议一致。

### 8.2 连接方式

```bash
# Daemon 启动
scorel daemon --port 18789
# stdout: ws://0.0.0.0:18789  token: sk-abc123xyz

# Client 连接（任何 Entry 都一样）
scorel attach ws://vps-ip:18789 --token sk-abc123xyz
```

```typescript
interface DaemonAuth {
  uri: string;    // ws://host:port 或 embedded://local
  token: string;  // 启动时随机生成
}
```

### 8.3 Token 管理

- 首次启动时生成随机 token，**持久化到 `~/.scorel/daemon.json`**
- 后续启动复用同一 token（除非用户手动 refresh）
- `scorel daemon token refresh` 手动重新生成
- 可通过 `--token <value>` 指定固定 token（方便脚本/CI）
- 连接时 token 放在 WS 首帧（`Authorization: Bearer sk-xxx`）
- Token 错误 → 立即断开，不泄露任何信息

```json
// ~/.scorel/daemon.json
{
  "token": "sk-abc123xyz...",
  "createdAt": 1716000000000,
  "port": 18789
}
```

初期不做：OAuth、证书、权限分级、IP 白名单。所有持有 token 的 client 权限相同。

---

## 9. 生命周期

### 9.1 启动

```bash
# Embedded（默认，CLI 用户无感知）
scorel chat

# Local standalone
scorel daemon start
scorel attach           # CLI 连接本地 daemon

# Remote
scorel daemon start --listen 0.0.0.0:18789 --token auto
# 在其他机器
scorel attach --remote ws://vps:18789 --token xxx
```

### 9.2 停止

- Embedded：CLI 退出即停
- Standalone：`scorel daemon stop` 或 SIGTERM
- 优雅退出：等待当前 turn 完成 → flush session → 通知所有 client `disconnecting` → close

### 9.3 无 Client 时行为

- 如果有 Channel（IM bot / cron）在跑 → 继续运行
- 如果无 Channel 且无 client → 可配置自动停止（默认 30 分钟无活动）

---

## 10. 边界情况

### 10.1 取消生成

- `message_start` 已广播（带预分配 eventId）
- 用户 cancel → runtime 停止
- 该 eventId **不会** 出现在 PersistentEvent 中（如果无文本）
- Daemon 广播 `message_cancelled { eventId, reason: "user_cancel" }`
- Client 丢弃对应 transient buffer

### 10.2 树模型中的 Compact

- CompactEvent 只影响**它的后代**的 context 构建
- 在 compact 点之前分叉的其他分支不受影响
- 旧事件仍在 JSONL 中，可供历史浏览

### 10.3 Clone Session

- Clone = 将远端 session 的 PersistentEvents 复制到本地 daemon
- 新 session 的 deviceId = 本地 daemon 的 deviceId
- `SessionHeader.clonedFrom` 记录来源溯源
- Clone 后本地 session 完全独立，不再与远端同步
- 连接到本地 daemon 的其他 client 可以 control 这个 cloned session

---

## 11. 初期范围与延后项

**初期落地**
- `Daemon` 类（持有 Runtime + Session + 事件广播）
- `EmbeddedTransport`（CLI 进程内零开销）
- Event seq per-session + 环形缓冲 per-session（2MB 字节上限）
- Session lane 串行化
- CLI `scorel chat` 走 embedded daemon（用户无感知，但协议已统一）
- 三级重连同步（buffer → JSONL persistent → in-progress partial）
- Auth（token 生成 + 验证）

**后续**
- `SocketTransport`（本地 standalone 模式）
- `WsTransport`（远程模式）
- 权限分级
- Channel Manager 加载 IM / cron
- Global lane（多 session 限流）
- Daemon 进程管理（PID file、日志、crash recovery）
- Client 离线队列（断网时缓存指令，重连后发送）

---

*Daemon 是所有 Entry 和 Core 之间的唯一中介。它让 CLI 用户无感知地享受统一协议，同时让远端多 client 共享同一个 agent 成为可能。*
