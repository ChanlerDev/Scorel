# ADR-002：统一 Daemon 层架构

**状态**：已确认
**日期**：2026-05-22
**参与者**：Chanler, Claude

## 决策

在 Entry（CLI / GUI / WebUI / IM Bot）和 Scorel Core 之间引入统一的 **Daemon 层**。所有 Entry 都是 thin client，通过统一协议与 Daemon 交互。Daemon 是 Runtime 和 Session 的唯一持有者与写入者。

## 背景

原设计中 CLI 直接在进程内持有 Runtime，GUI/IM 各自处理连接逻辑。当需要：

- CLI 支持 remote control（本地 GUI 控制远端 VPS 上的 agent）
- IM Bot 和 GUI 共享同一个 session 实时协作
- 多 Entry 同时连接同一个 agent

每个 Entry 各自实现一套就会导致协议分裂、并发冲突、session 一致性无法保证。

## 核心设计

### 分层

```
Entry Layer（纯 UI / IO）
    │
DaemonClient（统一协议客户端）
    │ transport: embedded | socket | ws
    │
Daemon（运行时持有者，唯一 session writer）
    │
Scorel Core（Runtime + Session + Tools + Extensions）
    │
pi-ai + pi-agent-core
```

### Daemon 职责

| 管 | 不管 |
|---|---|
| 持有 Runtime 实例 | UI 渲染 |
| Session 读写（唯一 writer） | 输入 UX（补全、快捷键） |
| Event 广播给所有已连接 client | Client 端缓存策略 |
| 多 client 并发调度（session lane 串行） | Client 怎么展示消息 |
| Auth（令牌验证、连接准入） | Client 侧本地配置 |
| Extension / MCP 生命周期 | — |
| 断线重连 + missed event 补发 | — |

### 三种部署模式（三种 Transport 实现）

| 模式 | 场景 | Transport |
|---|---|---|
| **embedded** | CLI/GUI 单用户本地 | EmbeddedTransport（进程内直调，零开销） |
| **local standalone** | 多 Entry 共享、后台持久运行 | SocketTransport（Unix socket，文件权限 auth） |
| **remote** | VPS agent、手机遥控、IM bot / WebUI | WsTransport（WebSocket + TLS + token auth） |

三种实现共享 `DaemonTransport` interface，Client 代码不变。保持独立实现是因为安全模型、错误处理、重连策略各自不同。

Client 代码完全一样，传输层是可替换 adapter：

```typescript
interface DaemonTransport {
  send(msg: ClientMessage): void;
  onEvent(cb: (event: DaemonEvent) => void): () => void;
  close(): void;
}
```

### 协议方向

**Client → Daemon（指令）：**

```typescript
type ClientMessage =
  | { method: "connect"; params: { auth?: AuthToken; device: DeviceInfo } }
  | { method: "prompt"; params: { text: string; sessionId?: string } }
  | { method: "steer"; params: { text: string } }
  | { method: "abort" }
  | { method: "history"; params: { sessionId?: string } }
  | { method: "branch"; params: { entryId: string } }
  | { method: "session.new" }
  | { method: "session.resume"; params: { sessionId: string } }
  | { method: "session.list" }
  | { method: "slash"; params: { command: string; args: string } };
```

**Daemon → Client（事件流）：**

```typescript
type DaemonEvent = ScorelEvent
  | { type: "connected"; sessionId: string; config: RuntimeInfo }
  | { type: "session_switched"; sessionId: string }
  | { type: "client_joined"; deviceId: string }
  | { type: "client_left"; deviceId: string }
  | { type: "sync"; events: ScorelEvent[]; fromSeq: number };
```

### 多 Client 广播 + 重连同步

- 每个 event 带递增 `seq` 序号
- Daemon 保留近期 event 环形缓冲（可配置深度，默认 1000 条）
- Client 重连时携带 `lastSeq`，Daemon 补发 `lastSeq+1` 到当前的所有 event
- 超出缓冲范围的重连 → 全量 session replay（从 JSONL 重建）

### 并发控制

- 同一 session 的 prompt/steer 请求串行化（session lane，参考 OpenClaw）
- 多 session 可并发（后期，global lane 限流）
- 一个 client prompt 时，其他 client 的 prompt 排队或收到 `busy` 响应

## 典型场景

### VPS Agent + IM + 本地 GUI

```
┌─ VPS ───────────────────────────┐
│ Scorel Daemon (WS + Auth)       │
│   ├── Runtime                   │
│   ├── Session (JSONL)           │
│   ├── Tools (bash/read/write)   │
│   └── MCP servers               │
└───────┬──────────┬──────────────┘
        │ WS       │ WS
   ┌────┴────┐ ┌───┴──────┐
   │ IM Bot  │ │ 本地 GUI  │
   │(Telegram)│ │(macOS)   │
   └─────────┘ └──────────┘
```

IM 发消息 → GUI 实时看到。GUI 点 abort → IM 收到中断通知。同一个 session，同一份历史。

### 本地单用户 CLI

```
CLI 进程
  └── EmbeddedTransport → Daemon（同进程）→ Runtime
```

用户感知不到 daemon 存在。无额外进程、无序列化开销。协议一致，日后可无缝切换到 standalone / remote。

## 与现有设计的关系

| 文档 | 影响 |
|---|---|
| d000 架构 | Apps Layer 全部变成 thin client + DaemonClient |
| d002 Channel | ChannelAdapter 变成 Daemon 内部模块，不再暴露给 Entry |
| d001 Session | 唯一写入者 = Daemon，不再需要担心多进程竞争 |
| ADR-001 双体系 | 不变。Daemon 内部仍可选 API 体系或 CLI 体系 |

## 后续演进

- Session 存储从线性 rewind 升级为树状 DAG（`id + parentId`，参考 pi-mono SessionManager）
- Client 权限分级（只读 / 操作 / 管理）
- 多 session 并发（global lane 限流）
- Daemon 集群（多 agent 实例，负载均衡）— 远期

## 否决的方案

1. **Entry 各自直连 Runtime** — 无法多 client 共享 session，并发写 JSONL 冲突
2. **只在 remote 场景加 daemon** — 协议分裂，本地/远程两套代码路径
3. **HTTP SSE（而非 WS）** — SSE 单向，steer/abort 需另开 POST 通道，不如 WS 双向一体

## 参考

- **OpenClaw Gateway**：WS JSON-RPC daemon + Session Lane + Global Lane
- **pi-mono AgentSessionRuntimeHost**：嵌入式 runtime 持有者，session 切换/fork/branch 的统一入口
- **CodePilot Electron**：Main 进程持有 Next.js server，Renderer 通过 SSE 订阅事件
