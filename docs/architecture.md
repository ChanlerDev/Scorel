# Scorel 基础架构

> *"pi-ai 处理协议，ScorelRuntime 处理循环，Host 处理设备级协调，Scorel 处理资产与生态。"*
> *"一切时间旅行都是 Replay 的一种姿势。"*

---

## 0. 本文档的位置

本文档是 Scorel 架构总纲。具体机制见：

| 规约 | 主题 |
|---|---|
| `decisions/006-device-host-project-registry.md` | Device-level Host、Project Registry、UI/API 入口 |
| `decisions/007-relay-proxy-and-entry-routing.md` | Relay proxy、Entry/Device 授权关系与 Hosted WebUI 连接 |
| `spec/events.md` | PersistentEvent + TransientEvent |
| `spec/runtime.md` | ScorelRuntime 执行引擎 |
| `spec/daemon.md` | Host、Project、Session、transport、广播和重连 |
| `spec/client.md` | DaemonClient SDK |
| `spec/relay.md` | Relay proxy、配对、路由与 WebUI 多 Device 聚合 |
| `spec/session.md` | JSONL、Replay、Rewind、Fork、Compact |
| `spec/tools.md` | 内置工具与 MCP |
| `spec/extensions.md` | Hook、Extension、Prompt、Config |
| `spec/channels.md` | IM、cron、webhook 等非交互式入口 |

对外命令和包名继续使用 `daemon`。本文中的 **Host** 表示 daemon 的产品职责：一台 Device 一个 Host，而不是一个 cwd 一个 daemon。

---

## 1. 系统定位

Scorel 是构建在 **pi-ai** 之上的 AI Agent 工作台：

- pi-ai 负责 provider 协议、模型目录、跨 provider 消息转换和流式调用。
- `ScorelRuntime` 负责单个 Session 的 Agent Loop 和工具调度。
- `ScorelHost` 负责 Device 内的 Project、Session、Runtime、广播和持久化协调。
- CLI、WebUI、GUI、IM 和未来 HTTP API 都是 thin entry。

Scorel 自己做三件事：

1. **把对话变成资产**：统一事件模型、树状 JSONL、Replay、Rewind、Fork、Compact。
2. **把 workspace 变成 Project**：一台 Device 管理多个 Project，每个 Session 绑定一个 `projectId`。
3. **让多个入口共享状态**：所有 Entry 通过 DaemonClient 或 Host application service 操作同一份 Session。

### 1.1 核心决策

| 决策 | 说明 |
|---|---|
| Runtime 保持纯执行 | Runtime 接收 context 和工具，只负责执行 turn |
| Device-level Host | 一台 Device 默认一个 Host，Host 管理多个 Project |
| Project 是正式实体 | `projectId -> canonical workDir` 持久化到 `~/.scorel/projects.json` |
| Session 必须绑定 Project | Runtime 创建时按 `projectId` 解析 cwd 和 config |
| Daemon 是唯一 Session writer | Entry 不直接写 JSONL，不直接持有 Runtime |
| Client 是跨端 SDK | reconnect、dual-seq resync、request/response、投影逻辑复用 |
| Relay 是 proxy | Relay 只存授权关系和在线路由，不拥有 Project、Session、Runtime 或 JSONL |
| Transport 是 adapter | 当前 embedded + WS；后续 Relay、SSH stdio proxy、HTTP + SSE |
| pre-1.0 不保旧兼容 | 错误抽象直接删除，不添加 deprecated alias 或迁移层 |

---

## 2. 分层结构

```text
┌──────────────────────────────────────────────────────────────┐
│ Entry Layer: 纯 UI / IO                                     │
│  ├── apps/cli      scorel chat / attach / daemon / up        │
│  ├── apps/webui    Browser UI: Device -> Project -> Session  │
│  ├── Hosted WebUI  Relay entry for many Devices              │
│  ├── apps/gui      Desktop UI: Project -> Session            │
│  ├── apps/im       Telegram / WeCom / Slack                  │
│  └── HTTP API      REST command + SSE event stream           │
├──────────────────────────────────────────────────────────────┤
│ DaemonClient / Host Application Service                      │
│  ├── request / response correlation                          │
│  ├── reconnect + dual-seq resync                              │
│  └── transport: embedded | websocket | relay | ssh | http+sse │
├──────────────────────────────────────────────────────────────┤
│ ScorelHost (@scorel/daemon)                                  │
│  ├── DeviceIdentity                                          │
│  ├── ProjectRegistry       projectId -> canonical workDir    │
│  ├── SessionStore          JSONL, unique writer              │
│  ├── RuntimePool           sessionId -> projectId -> runtime │
│  ├── EventHub              per-session seq + resync          │
│  ├── ChannelManager                                          │
│  └── TransportAdapters                                       │
├──────────────────────────────────────────────────────────────┤
│ ScorelRuntime (@scorel/core)                                 │
│  ├── executeTurn(context)                                    │
│  ├── tool loop + cancel                                      │
│  └── provider adapter                                        │
├──────────────────────────────────────────────────────────────┤
│ pi-ai                                                        │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 Device、Project、Session

```text
Device
└── ScorelHost
    ├── Project A: /Users/alice/Scorel
    │   ├── Session 1
    │   └── Session 2
    └── Project B: /Users/alice/shortlink
        └── Session 3
```

领域模型：

```typescript
type ProjectId = Brand<string, "ProjectId">;

type HostProject = {
  projectId: ProjectId;
  displayName: string;
  workDir: string;
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

`projectId` 是稳定身份。路径只由 owning Host 解释。Client 不反推路径，不再使用 `projectSlug` 作为身份。

### 2.2 持久化

```text
~/.scorel/
├── config.toml
├── daemon.json
├── projects.json
├── sessions/
│   ├── <sessionId>.jsonl
│   └── <sessionId>.log
└── attach-cache/
    └── <scopeKey>/
        ├── <sessionId>.json
        └── <sessionId>.log
```

- `projects.json`：Host 管理的正式 Project Registry。
- `sessions/*.jsonl`：Session replay 资产，继续使用 flat 目录。
- `sessions/*.log`：daemon/runtime/provider diagnostics。
- `attach-cache/`：client 侧缓存和 diagnostics，不是权威状态。

### 2.3 包结构

```text
packages/
├── protocol/     # IDs、wire messages、events，零 Node 依赖
├── core/         # Runtime、Session、Tools、Config
├── daemon/       # Host、ProjectRegistry、RuntimePool、servers
└── client/       # DaemonClient、WsTransport、reconnect、projection

apps/
├── cli/          # 单一 scorel 入口
├── webui/        # Browser UI，只依赖 protocol + client
├── relay/        # 后续：Relay proxy service，不持有 Host 业务状态
├── gui/          # 后续：desktop main + renderer
└── im/           # 后续：channel runner
```

依赖方向：

```text
@scorel/protocol
    ↑
@scorel/core
    ↑
@scorel/daemon

@scorel/protocol
    ↑
@scorel/client

apps/* -> @scorel/client and/or @scorel/daemon
```

---

## 3. 数据流

### 3.1 Project 注册

```text
Entry
  -> listDirectories(path?)
  -> registerProject(workDir)
Host
  -> canonicalize workDir
  -> mint projectId
  -> persist projects.json
  -> return HostProject
```

### 3.2 创建 Session

```text
Entry
  -> createSession({ projectId })
Host
  -> ProjectRegistry.require(projectId)
  -> persist Session header { projectId }
  -> return sessionId
```

### 3.3 执行 turn

```text
Entry
  -> DaemonClient.sendMessage(sessionId, content)
Host
  -> SessionStore.load(sessionId)
  -> ProjectRegistry.require(session.meta.projectId)
  -> createRuntime({ cwd: project.workDir, config: loadConfig(project.workDir) })
  -> ScorelRuntime.executeTurn(context)
  -> append persistent events to JSONL
  -> broadcast transient + persistent events
```

关键不变量：**UI 选择的 Project、Session header 中的 `projectId`、Runtime 实际 cwd 必须一致。**

### 3.4 重连

```text
Client reconnect
  -> connect({ sessionId, persistentLastSeq, streamLastSeq })
  -> ring buffer resume
  -> JSONL persistent fallback
  -> full reload
```

---

## 4. Entry 产品模型

### 4.1 CLI

```text
scorel chat --cwd .
  -> temporary embedded Host
  -> register current cwd
  -> create or resume Session under projectId
```

CLI cwd 表示“本次打开的 workspace”，不是 daemon 身份。

### 4.2 WebUI

WebUI 只能操作在线 Device：

```text
Device
└── Project
    └── Session
```

添加项目：

```text
Sidebar Add Project
  -> choose Device
  -> browse Host directories
  -> registerProject(path)
```

WebUI 可以通过多种 connector 连接同一个 Device：

```text
Device
  ├── direct_ws connector
  └── relay connector
```

Device 是业务身份；connector 只是可达路径。相同 `deviceId` 通过 direct WS 和 Relay 都可达时，WebUI 应合并为一个 Device。Project 和 Session 仍然通过 Host API 获取，不能从 Relay 获取。

### 4.3 Relay

Relay 是 Hosted WebUI 和用户本机 Host 之间的 proxy：

```text
Entry/WebUI -> Relay -> Host/Daemon -> Project/Session/Runtime
```

Relay 持久化：

```text
deviceId -> allowed clientId
```

Relay 运行时维护：

```text
client socket -> Relay -> device socket
```

Relay 不存 Project、Session、prompt、tool result、Runtime 或 replay cache。Relay 只在 transport 外层增加 `deviceId` 路由和授权检查，payload 仍然是现有 daemon wire message。

### 4.4 GUI

GUI 以后使用 Project-first 聚合：

```text
Project
└── Session
```

- Local：系统文件夹选择器 -> local Host。
- Remote：SSH Device -> `scorel proxy` -> remote Host -> directory picker。
- Direct WS + token：高级入口，连接已经运行的 Host。

### 4.5 HTTP API

未来 HTTP 是 Host transport adapter：

```text
POST /projects
POST /projects/:projectId/sessions
POST /sessions/:sessionId/messages
GET  /sessions/:sessionId/events
```

HTTP handler 不直接碰 Runtime 或 JSONL。

---

## 5. Transport

| Transport | 状态 | 场景 |
|---|---|---|
| `EmbeddedTransport` | 已有 | CLI 临时 Host |
| `WsTransport` | 已有 | 本机 WebUI、Direct WS、远端控制 |
| `RelayTransport` | 后续 | Hosted WebUI / GUI 通过 Relay 连接多 Device |
| SSH stdio proxy | 后续 | GUI 连接远端 Device |
| HTTP + SSE | 后续 | 纯 API |

S0043 已删除 Node socket transport。SSH proxy 后续可以转发到 Host control endpoint，但 proxy 自身不持有 Project、Session 或 Runtime。

RelayTransport 后续只实现 routing/authorization transport，不实现 Project、Session、Runtime、replay 或 resync 逻辑。

当前可信用户模型：拥有 token 或 SSH 凭据即拥有 Device 的完整能力。不做细粒度 ACL，但日志不得记录 secret。

---

## 6. 设计哲学

1. **一个 Device，一个 Host**：Project 是 Host 资产，不是 daemon 启动参数。
2. **一个 Session，一个 Project**：Session header 固定 `projectId`，Runtime cwd 由 Host 解析。
3. **所有 Entry 都薄**：CLI、WebUI、GUI、IM、HTTP 不重复实现 Runtime 或持久化。
4. **HTTP 也是 adapter**：不能为了 API 绕开 Host。
5. **Event Sourcing 贯穿始终**：持久事件写 JSONL，流式 delta 走 live bus。
6. **pre-1.0 做减法**：错误抽象直接删，不保兼容别名。

---

## 7. 架构风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| Project 与 Runtime cwd 错配 | Agent 在错误仓库执行工具 | Session 只存 `projectId`；Runtime 创建必须查询 Registry |
| Project Registry 丢失 | 无法打开已添加但无 Session 的 workspace | `projects.json` 独立持久化；测试 restart |
| Host 单点故障 | 所有 client 断连 | JSONL replay；daemon lifecycle；后续 supervisor |
| WebUI 重复实现投影 | GUI/API 再次复制逻辑 | 可复用逻辑逐步下沉 `@scorel/client` |
| Relay 膨胀成云端后端 | Workspace authority 被搬离用户 Device | Relay 只存授权关系和在线路由；业务状态仍由 Host 持有 |
| SSH proxy 边界模糊 | proxy 变成第二套 daemon | proxy 只转发字节，业务只在 Host |
| HTTP 旁路 | API 与 GUI 行为不一致 | HTTP handler 只调用 Host application service |

---

*架构核心：Device-level Host + Project Registry + Session JSONL + thin entries。*
