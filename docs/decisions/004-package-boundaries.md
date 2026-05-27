# ADR-004：Protocol / Core / Daemon / Client 包边界

**状态**：已确认  
**日期**：2026-05-26  
**参与者**：Chanler, Codex

## 决策

Scorel 最终采用 **四个能力包 + 多 app** 的 monorepo 结构：

```text
packages/
  protocol/     # @scorel/protocol：跨端协议，零 Node 依赖
  core/         # @scorel/core：Runtime、Session、Events、Tools、MCP、Extensions
  daemon/       # @scorel/daemon：Runtime 上层管理面，唯一 session writer
  client/       # @scorel/client：多端 SDK，连接 daemon 并 fold 本地 UI state

apps/
  cli/          # scorel chat / attach / daemon
  daemon/       # standalone daemon service / Docker / systemd
  webui/        # browser UI，只依赖 protocol + client
  gui/          # desktop main 管 daemon，renderer 用 client
  im/           # IM bot / channel runner（后期）
```

核心规则：

- 所有交互式 Entry 都面向 Daemon，不直接持有 Runtime。
- Daemon 是 Runtime 的上层管理面，负责 runtime pool、session lane、event broadcast、auth、transport server。
- Core 只提供底层执行与资产能力，不做 server，不知道 client。
- Client 只是 Entry 侧连接与同步复用层，不是 Daemon 的替代品。
- Apps 只组合产品入口和 UI，不沉淀领域逻辑。

## 背景

早期文档倾向单包 `@scorel/core`，内部用 `src/protocol/` 建硬边界。这适合 0 到 1 快速落地，但长期会出现三个问题：

1. WebUI 运行在浏览器，不应被 `fs`、MCP stdio、socket server 等 Node-only 依赖污染。
2. CLI / GUI / WebUI / IM 都要处理连接、重连、`lastSeq` resync、transient delta、本地 tree projection，如果没有 Client 层会重复实现。
3. Daemon 是产品运行面，不只是 Core 的一个子目录。它需要独立承载 local daemon、remote daemon、embedded host、service/Docker 部署。

因此需要把“协议契约、底层领域能力、运行管理面、Entry 侧 SDK”拆开。

## 包职责

### `@scorel/protocol`

只放跨端契约：

- ID 类型：`SessionId` / `EventId` / `ClientId` / `Seq`
- 消息类型：`ScorelMessage` / `ContentBlock`
- 事件类型：`PersistentEvent` / `TransientEvent`
- 线协议：`ClientMessage` / `DaemonMessage` / `ErrorCode`
- schema 与纯函数校验

约束：零 Node API，零内部 Scorel 包依赖。

### `@scorel/core`

底层执行与资产能力：

- `ScorelRuntime`
- `SessionTree` / JSONL store / `buildContext`
- `EventTypeHandler`
- 内置工具、MCP tool registry
- Hooks、Extensions、PromptBuilder、Config
- Compact

约束：可以依赖 `@scorel/protocol` 和 pi-ai，不依赖 `@scorel/daemon` / `@scorel/client` / `apps/*`。

### `@scorel/daemon`

Runtime 上层管理面：

- Daemon lifecycle
- RuntimePool
- RuntimeBridge
- SessionLane
- EventBroadcaster
- ConnectionManager
- Auth
- Socket / WebSocket server
- Embedded host / embedded transport adapter
- ChannelManager

约束：Daemon 是唯一 session writer。Apps 可以启动、管理、连接 Daemon，但不能绕过 Daemon 直接写 Session。

### `@scorel/client`

Entry 侧多端 SDK：

- DaemonClient
- request/response correlation
- 连接状态机
- reconnect + `lastSeq` resync
- event stream → local UI state reducer
- transient buffer
- WS transport
- Node socket transport（subpath export）

约束：Client 不依赖 `@scorel/core` 或 `@scorel/daemon`。In-process embedded adapter 由 `@scorel/daemon` 提供，因为它需要接触 Daemon 实例。

## Apps 规则

| App | 依赖 | 说明 |
|---|---|---|
| `apps/cli` | `@scorel/client`，必要时 `@scorel/daemon` | `scorel chat` ensure/start daemon 后连接；`scorel attach` 只连已有 daemon |
| `apps/daemon` | `@scorel/daemon` | standalone service / Docker / systemd 入口 |
| `apps/webui` | `@scorel/protocol` + `@scorel/client` | 浏览器 UI，只通过 WS 连 daemon |
| `apps/gui` | main: `@scorel/daemon`；renderer: `@scorel/client` | main 管 local daemon，renderer 不触碰 core/daemon |
| `apps/im` | `@scorel/client` 或 daemon channel | 视部署形态决定，后期实现 |

CLI 命令形态：

```text
scorel chat      # ensure/start local daemon，然后作为 client 连接
scorel daemon    # 显式启动可被 remote control 的 daemon
scorel attach    # 连接已有 local/remote daemon
```

如果要 remote control，Daemon 必须是可持续运行、可发现、可认证的实例，不能只是 `scorel chat` 内部临时对象。

## 依赖方向

```text
@scorel/protocol
    ↑
@scorel/core
    ↑
@scorel/daemon

@scorel/protocol
    ↑
@scorel/client

apps/* → @scorel/daemon and/or @scorel/client
```

禁止：

- `protocol -> core/client/daemon`
- `core -> daemon/client/apps`
- `daemon -> client/apps`
- `client -> core/daemon`
- `packages/* -> apps/*`

## 否决的方案

### 单包 `@scorel/core`

短期简单，但长期会把 browser-safe protocol/client 与 Node-only runtime/daemon 混在一起。WebUI 和 GUI renderer 会被迫通过 `@scorel/core` 获取类型，包名和依赖语义都不干净。

### 只拆 `protocol + core`

比单包好，但 Daemon 仍被当作 Core 子模块。remote daemon、local service、embedded host、daemon lifecycle 都会挤在 Core 里，边界不清。

### Apps 直接使用 Runtime

会绕过 Daemon 的唯一 writer、session lane、event seq、broadcast 和 auth，破坏多端同步一致性。

### 没有 Client 层

Daemon 可以支撑系统运行，但 CLI/GUI/WebUI 会重复实现连接、重连、resync、transient buffer、本地 tree reducer，最终协议处理分裂。

## 影响

- `docs/architecture.md` 的包结构更新为 `protocol / core / daemon / client / apps`。
- 后续实现不应再按“单包 core 内含 daemon/client”作为最终目标。
- 首个实现阶段如需压缩范围，也应至少保持 `protocol/core/daemon` 的真实包边界；`client` 可在第二个 app 出现前后抽，但最终必须独立。
