# ADR-004：Protocol / Core / Daemon / Client 包边界

**状态**：已确认，2026-06-01 修订
**日期**：2026-05-26  
**参与者**：Chanler, Codex

## 决策

Scorel 采用 **四个能力包 + 多产品入口**：

```text
packages/
  protocol/     # @scorel/protocol：跨端协议，零 Node 依赖
  core/         # @scorel/core：Runtime、Session、Tools、MCP、Extensions
  daemon/       # @scorel/daemon：Device-level Host，唯一 session writer
  client/       # @scorel/client：多端 SDK，连接 Host 并 fold 本地 UI state

apps/
  cli/          # 单一 scorel 二进制：chat / attach / daemon / webui / up / logs
  webui/        # browser UI，只依赖 protocol + client
  gui/          # 未来 desktop 产品入口
  im/           # 未来 IM channel runner
```

`apps/daemon` 和 Unix socket transport 已由 S0043 删除，不再作为目标架构恢复。

## 核心规则

- 所有交互式 Entry 都面向 Host，不直接持有 Runtime。
- 一个 Device 只有一个逻辑 Host。Host 管理本机全部已注册 Project。
- Host 是 Runtime 和 Session 的唯一持有者与写入者。
- Core 提供执行与资产能力，不做 server，不知道 client。
- Client 负责连接、重连、resync 和 UI projection，不复制 Host 业务逻辑。
- Apps 只组合产品入口和 UI，不沉淀领域逻辑。

Device-level Host 和 Project Registry 细节见 [`ADR-006`](006-device-host-project-registry.md)。

## 包职责

### `@scorel/protocol`

- `DeviceId` / `ProjectId` / `SessionId` / `EventId` / `ClientId` / `Seq`
- `HostProject` / `SessionMeta` / `SessionSummary`
- `ScorelMessage` / `ContentBlock`
- `PersistentEvent` / `TransientEvent`
- wire request / response / event schema
- schema 校验和纯函数

约束：零 Node API，零内部 Scorel 包依赖。

### `@scorel/core`

- `ScorelRuntime`
- `SessionTree` / JSONL store / `buildContext`
- 内置 tools、MCP tool registry
- Hooks、Extensions、PromptBuilder、Config
- Compact

约束：可依赖 `@scorel/protocol` 和 pi-ai，不依赖 `@scorel/daemon`、`@scorel/client` 或 `apps/*`。

### `@scorel/daemon`

- `ScorelHost`
- `ProjectRegistry`
- project-aware Runtime factory / Runtime pool
- Session lane、event broadcaster、connection manager
- Auth 和 WebSocket server
- Embedded transport adapter
- 未来 SSH stdio proxy server adapter

约束：Host 是唯一 Session writer。Apps 可以启动或连接 Host，但不能绕过 Host 直接写 Session。

### `@scorel/client`

- `DaemonClient`
- request/response correlation
- 连接状态机
- reconnect + dual-seq resync
- event stream → local UI state reducer
- transient buffer
- browser-safe WebSocket transport
- 未来 SSH proxy client adapter 和 HTTP adapter

约束：Client 不依赖 `@scorel/core` 或 `@scorel/daemon`。In-process embedded adapter 由 `@scorel/daemon` 提供。

## Apps 规则

| App | 依赖 | 说明 |
|---|---|---|
| `apps/cli` | `@scorel/client`，必要时 `@scorel/daemon` | 当前唯一 Node 产品入口；可启动 embedded Host 或 WS Host |
| `apps/webui` | `@scorel/protocol` + `@scorel/client` | Device-first browser UI，只通过 WS 连 Host |
| `apps/gui` | main: `@scorel/daemon` / `@scorel/client`；renderer: `@scorel/client` | 未来 Project-first desktop UI；main 管本地 Host 和 SSH proxy |
| `apps/im` | `@scorel/client` 或 Host channel | 后期实现 |

CLI 命令形态：

```text
scorel chat          # 当前 cwd 注册为 Project，使用 embedded Host
scorel attach        # 连接已有 Host
scorel daemon serve  # 启动可被 remote control 的 WS Host
scorel webui         # 启动 WebUI
scorel up            # 拉起 WS Host + WebUI
```

## Transport 边界

当前：

| Transport | 用途 |
|---|---|
| Embedded | CLI 本地交互 |
| WebSocket + token | WebUI、CLI remote attach、直接远程连接 |

未来：

| Adapter | 用途 |
|---|---|
| SSH stdio proxy | GUI 管理远程 Device；安装、启动或连接远端 Scorel |
| HTTP + SSE | 纯 API 集成 |

HTTP 和 SSH 只映射同一 Host use cases，不复制 Project、Session 或 Runtime 管理逻辑。

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

### 每个 Project 一个 daemon

这会把 Device 管理能力拆散，GUI / WebUI 无法统一添加 Project、浏览目录和创建 Session。Host 必须拥有 Device 级 Registry。

### Apps 直接使用 Runtime

会绕过唯一 writer、session lane、event seq 和 broadcast，破坏多端一致性。

### 恢复 Unix socket transport

S0043 已经删除该路径。当前本地 CLI 使用 embedded，跨进程和远程使用 WS。新增 GUI 远程入口应投入 SSH proxy，而不是重新维护 socket 产品面。

### 为 HTTP API 复制业务服务

HTTP API 只应成为 transport adapter。Project Registry 和 Session 生命周期仍归 Host。

## 影响

- `projectId` 取代 `projectSlug` 成为 Project 稳定身份。
- `apps/daemon` 保持删除状态。
- `@scorel/daemon` 从“单 cwd daemon”升级为 Device-level Host。
- GUI、WebUI 和未来 HTTP API 使用同一 Host contract。
