# Scorel 基础架构

> *"pi-ai 处理协议，ScorelRuntime 处理循环，Daemon 处理协调，Scorel 处理资产与生态。"*
> *"一切时间旅行都是 Replay 的一种姿势。"*

---

## 0. 本文档的位置

本文档是 Scorel 从 0 到 1 阶段的 **基础架构稿**，负责三件事：

1. 说清 Scorel 在 pi-ai 栈中的定位
2. 给出分层结构与数据流
3. 作为其他规约文档的总纲

具体模块的机制不在这里展开，读者需要看某一块的设计细节时，请跳到对应规约：

| 规约 | 主题 |
|------|------|
| `spec/events.md` | 统一事件模型：PersistentEvent + TransientEvent，两层分离 |
| `spec/runtime.md` | ScorelRuntime：执行引擎、persist 策略、cancel 处理、双队列 |
| `spec/daemon.md` | Daemon 层：协议、transport、广播、重连同步、并发控制、auth |
| `spec/client.md` | DaemonClient SDK：Client 侧统一接口 |
| `spec/session.md` | Session 存储：JSONL v1、树状结构、Rewind、Fork、Checkpoint、压缩 |
| `spec/tools.md` | 工具系统：内置工具集、MCP 集成 |
| `spec/extensions.md` | 扩展点：Hooks、Extensions、System Prompt 组装、配置系统 |
| `spec/channels.md` | Channel：Daemon 内部的非交互式消息注入适配器 |

---

## 1. 系统定位

Scorel 是构建在 **pi-ai** 之上的 **应用层编排平台**：

- **底层协议**交给 pi-ai：10+ provider 统一接入、跨 provider 消息转换（`transformMessages`）、流式事件、模型目录
- **Agent Loop** 自建（ScorelRuntime）：多轮推理 + 工具执行 + 流式输出，只调 pi-ai 的 `streamSimple`
- **Scorel 自己做三件事**：
  1. **把对话变成资产**：统一事件模型（PersistentEvent + TransientEvent），树状 JSONL，rewind / fork / compact 共享同一套机制
  2. **多端统一接入**：Daemon 层 + DaemonClient 协议，CLI / GUI / WebUI / IM 共享同一个 Session 实时同步
  3. **扩展生态**：Hooks、Extensions、MCP 分级加载（Skills、Memory 为后期）

### 1.1 核心设计决策

| 决策 | 说明 |
|------|------|
| ScorelRuntime 自建 Agent Loop | 自建循环 + 工具调度，只依赖 pi-ai 的 streamSimple 做 LLM 调用 |
| 统一事件模型 | PersistentEvent（存储+同步）+ TransientEvent（仅广播），详见 `spec/events.md` |
| Provider 分层依赖 pi-ai 的 `Api/Provider/Model` | 不在上层叠 Runtime/Transport/Provider 三层 |
| 跨 provider 消息转换交给 pi-ai 的 `transformMessages` | 脏活不自己干 |
| 统一 Daemon 层 | 所有 Entry 是 thin client，Daemon 唯一持有 Runtime + Session（ADR-002） |
| 包边界分层 | `protocol / core / daemon / client / apps` 分层，Daemon 独立于 Core（ADR-004） |
| 三种部署模式共用一套协议 | embedded / local socket / remote WS，DaemonClient API 不变 |
| Event Sourcing + Replay | Rewind / Fork / File Checkpoint / Compact 共享同一个 replay 函数 |

---

## 2. 分层结构

```
┌─────────────────────────────────────────────────────────┐
│  Entry Layer（纯 UI / IO，thin client）                  │
│  ├── apps/cli      REPL + 斜杠命令                       │
│  ├── apps/gui      Tauri / Electron 桌面端               │
│  ├── apps/webui    浏览器端                              │
│  └── apps/im       IM Bot（Telegram / WeCom / Slack）    │
├─────────────────────────────────────────────────────────┤
│  DaemonClient（统一协议客户端）          → spec/client.md │
│  ├── transport/    embedded | socket | ws                │
│  └── 接口：prompt / steer / followUp / abort / ...       │
├─────────────────────────────────────────────────────────┤
│  Daemon（运行时持有者，唯一 session writer）              │
│  ├── session 持有 + 并发控制（session lane）             │
│  ├── event 广播 + seq per-session + 重连三级 fallback    │
│  ├── steeringQueue + followUpQueue（双队列）             │
│  ├── channel/      IM / cron 消息注入适配器              │
│  ├── auth          连接准入 + 令牌验证                   │
│  └── 部署：embedded | local standalone | remote          │
│                                          → spec/daemon.md │
├─────────────────────────────────────────────────────────┤
│  ScorelRuntime（执行引擎）              → spec/runtime.md │
│  ├── executeTurn(context) → AsyncGenerator<RawEvent>     │
│  ├── 工具循环 + cancel 处理                              │
│  └── persist 策略（有内容就 persist）                    │
├─────────────────────────────────────────────────────────┤
│  Scorel Core                                            │
│  ├── session/      JSONL + Tree + buildContext           │
│  ├── compaction/   上下文压缩（硬边界）                  │
│  ├── tools/        内置工具 + MCP                        │
│  ├── hooks/        原生 hook + 广播事件                   │
│  ├── extensions/   扩展加载与错误隔离                    │
│  ├── prompt/       System Prompt 组装                    │
│  └── config/       TOML 多层配置                         │
├─────────────────────────────────────────────────────────┤
│  pi-ai           Provider Protocol + streamSimple       │
└─────────────────────────────────────────────────────────┘
```

### 2.1 包结构

最终包结构采用 **四个能力包 + 多 app**。包边界直接对应运行时边界：Protocol 是跨端契约，Core 是底层执行与资产能力，Daemon 是 Runtime 上层管理面，Client 是 Entry 侧连接与同步 SDK，Apps 只做产品入口。

```
packages/
├── protocol/                      ← @scorel/protocol
│   └── src/
│       ├── ids.ts                 ── SessionId / EventId / ClientId / Seq
│       ├── messages.ts            ── ScorelMessage / ContentBlock
│       ├── events.ts              ── PersistentEvent / TransientEvent
│       ├── wire.ts                ── ClientMessage / DaemonMessage / ErrorCode
│       ├── schemas.ts             ── runtime validation（零 Node API）
│       └── index.ts
├── core/                          ← @scorel/core
│   └── src/
│       ├── events/                ── EventTypeHandler + convertToLlm handlers
│       ├── session/               ── JSONL Store + SessionTree + buildContext
│       ├── runtime/               ── ScorelRuntime（纯执行引擎）
│       ├── tools/                 ── 内置工具 + MCP tool registry
│       ├── extensions/            ── Hooks + ExtensionRunner
│       ├── prompt/                ── System Prompt 组装
│       ├── config/                ── TOML 配置
│       └── index.ts
├── daemon/                        ← @scorel/daemon
│   └── src/
│       ├── daemon.ts              ── Daemon lifecycle
│       ├── runtime-pool.ts        ── 每个 session 一个 RuntimeBridge
│       ├── runtime-bridge.ts      ── RawRuntimeEvent → ScorelEvent + persist
│       ├── session-lane.ts        ── 同 session 写操作串行化
│       ├── broadcaster.ts         ── per-session seq + ring buffer
│       ├── server/                ── socket / ws server
│       ├── embedded/              ── in-process host / embedded transport adapter
│       ├── auth/                  ── token / local auth
│       ├── channels/              ── IM / cron / webhook adapters
│       └── index.ts
└── client/                        ← @scorel/client
    └── src/
        ├── daemon-client.ts       ── request/response + event subscription
        ├── reducer.ts             ── event stream → local UI state
        ├── reconnect.ts           ── lastSeq + resync
        ├── transports/
        │   ├── ws.ts              ── browser / remote
        │   └── socket.ts          ── Node local socket（subpath export）
        └── index.ts

apps/
├── cli/                           ← scorel chat / attach / daemon
├── daemon/                        ← standalone daemon service / Docker / systemd
├── webui/                         ← browser UI，只依赖 protocol + client
├── gui/                           ← main 管 daemon，renderer 用 client
└── im/                            ← IM bot / channel runner（后期）
```

**依赖方向**（单向无环）：

```
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

**硬约束**：

| 包 | 可以依赖 | 禁止依赖 |
|---|---|---|
| `@scorel/protocol` | 无 | Node API、其他 Scorel 包 |
| `@scorel/core` | `@scorel/protocol`、pi-ai | `@scorel/daemon`、`@scorel/client`、`apps/*` |
| `@scorel/daemon` | `@scorel/protocol`、`@scorel/core` | `@scorel/client`、`apps/*` |
| `@scorel/client` | `@scorel/protocol` | `@scorel/core`、`@scorel/daemon` |
| `apps/*` | `@scorel/client` 和/或 `@scorel/daemon` | 互相依赖、沉淀领域逻辑 |

**App 接入规则**：

- Apps 可以启动、管理、连接 Daemon，但不能绕过 Daemon 直接写 Session 或直接持有 Runtime。
- `scorel chat` 也走 Daemon 抽象；差异只是 embedded / local / remote deployment。
- Remote control 必须连接可持续运行的 Daemon，不能依赖 CLI 内部临时对象。
- WebUI 只依赖 `@scorel/protocol` + `@scorel/client`，不触碰 Node-only Core。
- GUI main process 可以管理 local Daemon，renderer 仍通过 Client 连接。

---

## 3. 数据流

```
外部输入（CLI / GUI / WebUI / IM / cron）
    ↓
Entry（thin client）
    ↓  DaemonClient.sendMessage(msg) / .steer(msg) / .followUp(msg) / .cancel()
DaemonTransport（embedded | socket | ws）
    ↓
Daemon
    ├── auth 验证
    ├── session lane 串行化
    ├── 如 Agent 空闲 → RuntimeBridge.executeTurn(msg)
    ├── 如 Agent 运行中 → steeringQueue.push(msg)
    └── followUp → followUpQueue.push(msg)（agent 停下后消费）
    ↓
ScorelRuntime.executeTurn(context)
    │
    ├── transformContext(messages)            ← Scorel 拦截
    │     ├── replayRewinds(messages)            1. 解析 rewind 标记
    │     └── compactIfOverThreshold(messages)   2. 超阈值触发压缩
    │
    ├── convertToLlm(messages)                ← Scorel 拦截
    │     └── 过滤 rewind / file_snapshot / channel_metadata 等自定义消息
    │
    ├── pi-ai.streamSimple(model, context)
    │     └── transformMessages                ← pi-ai 内部：跨 provider 转换
    │
    ├── 工具调度
    │     ├── beforeToolCall                  ← Scorel 拦截：File Checkpoint
    │     ├── tool.execute()
    │     └── afterToolCall
    │
    └── yield RawRuntimeEvent
          ↓ RuntimeBridge 转换
          ├→ Daemon.broadcast(event, seq)     ← 带序号广播给所有 client
          ├→ SessionStore.append(event)       ← 同步写 JSONL
          └→ ExtensionRunner.emit(event)      ← 扩展广播

Client 重连时：
    DaemonClient.connect({ lastSeq }) → Daemon 补发 missed events
    超出缓冲范围 → JSONL persistent fallback → 全量 replay
```

---

## 4. 关键洞察：两层消息

pi-ai / pi-agent-core 内置 **两层消息抽象**，Scorel 深度依赖它：

| 层 | 类型 | 谁能看到 |
|---|------|---------|
| **应用层** | `AgentMessage`（UserMessage / AssistantMessage / ToolResultMessage / **自定义类型**） | UI / 存储 / Extension / Channel |
| **LLM 层** | `Message`（LLM 协议要求的严格子集） | LLM |

转换点：`convertToLlm(AgentMessage[]) → Message[]`。自定义类型（`rewind`、`file_snapshot`、`channel_metadata`）只存在于应用层，LLM 永远看不到。

这是 Event Sourcing 架构能工作的根本原因——**存储里可以出现任何消息，LLM 只看到清洗过的那一份**。

---

## 5. 设计哲学

1. **站在巨人肩膀上**
   - pi-ai 干脏活（provider 适配、跨 provider 消息转换）
   - pi-agent-core 干 Loop
   - Scorel 只做差异化：资产化、多端、生态

2. **统一 Daemon，灵活部署**
   - 所有 Entry 是 thin client，Daemon 是唯一的 Runtime/Session 持有者
   - 同一套协议，三种部署模式（embedded / local / remote）
   - Entry 面向同一个 DaemonClient API，部署差异收敛到 transport / daemon host

3. **Event Sourcing：一切时间旅行都是 Replay**
   - Rewind / Fork / File Checkpoint / Compact 都是同一个 replay 函数的不同输入
   - JSONL 永不删除，一切历史可追溯、可调试、可审计

4. **两层消息，清晰隔离**
   - 应用层（`AgentMessage`）：存储 / UI / Extension 看得到一切
   - LLM 层（`Message`）：LLM 只看到 `convertToLlm` 过滤后的干净版本
   - 自定义消息类型随便加，不污染 LLM

5. **多 Client 实时同步**
   - Event 带 per-session seq 序号，per-session 环形缓冲（2MB 字节上限）
   - 重连三级 fallback：缓冲补发 → JSONL persistent → in-progress partial
   - 任何 Entry 的操作对其他 Entry 实时可见

6. **核心做减法，扩展做加法**
   - 核心只保留最通用机制（Session / Daemon / Hook / Config）
   - Extension / MCP / Skill 做定制化，出错不影响核心

---

## 6. 实现原则

1. **pi 栈优先**：能用 pi-ai / pi-agent-core 做的，绝不自己写
2. **错误是数据，不是异常**：pi-ai 的工具错误、LLM 错误都被编码成 `AssistantMessage` 的 stopReason，不抛异常
3. **Event Sourcing 贯穿始终**：任何状态变更必须先 append 到 JSONL，内存状态由 replay 推导
4. **两层消息绝不混用**：自定义消息只存在于应用层，`convertToLlm` 是唯一边界
5. **Extension 错误隔离**：单个扩展失败必须不阻塞核心和其他扩展
6. **版本包一层**：所有 pi 栈类型重新 export 成 Scorel 命名空间，未来换底层或调整包名只改 adapter 层

---

## 7. 参考项目

| 来源 | 借鉴点 |
|------|--------|
| **pi-mono** (`pi-ai`) | 直接依赖：Provider 协议、streamSimple、模型目录、跨 provider 消息转换 |
| **pi-mono** (`coding-agent`) | 树状 Session（id + parentId）、AgentSessionRuntimeHost（嵌入式 daemon）、branching/compaction |
| **OpenClaw** | WS Gateway daemon、Session Lane + Global Lane 双队列、多 client 广播、重连补发 |
| **Claude Code** | Append-only JSONL + Replay、Rewind 通过 marker 而非删除、`<system_reminder>` 注入、斜杠命令 |
| **CodePilot** | Electron + Next.js SSE 事件流、保守并行（只读工具才并行）、结构化错误、Bridge 抽象 |
| **Bub** (learn-claude-code) | Harness 哲学、Tape-based 上下文；Subagent / Skills 为后期借鉴 |
| **Hermes Agent** | Memory System（后期）、Prompt Caching 保护、Profile 多实例（后期） |

---

## 8. 架构风险

| 风险 | 说明 | 缓解 |
|------|------|------|
| **pi-agent-core 单人维护** | 上游维护者 bus factor = 1 | Scorel 包一层 adapter；版本冻结策略；必要时 fork |
| **pi-\* 包版本紧耦合** | pi-ai 和 pi-agent-core 版本必须同步 | 依赖范围锁死到 patch 级，更新前先跑回归 |
| **Steering 不能 mid-turn 打断** | 工具执行中用户插话要等工具完成 | UX 承诺 "等待当前工具"，长工具用 `cancel()` 兜底 |
| **TypeBox vs Zod 不兼容** | MCP 生态常见 Zod | 写 TypeBox ↔ JSON Schema 转换层（pi-ai 已有 `convertJsonSchemaToTypeBox`） |
| **Event Sourcing 的 JSONL 膨胀** | 长 session 文件会很大 | Compact 标记 + 旧 snapshot 归档到 `.archive/`（后期） |
| **Daemon 单点故障** | Daemon 进程挂掉 = 所有 client 断连 | 优雅退出 + crash recovery（重启后从 JSONL replay 恢复状态） |
| **环形缓冲溢出** | 长时间断线 client 重连时缓冲不够 | 降级到 JSONL persistent fallback；可配置缓冲深度 |
| **Remote Daemon 安全** | WS 暴露到公网 | TLS 强制 + token auth + 可选 IP 白名单 |

---

*架构核心：Event Sourcing + Replay，两层消息分离，Channel 归一，底层依赖 pi-ai + pi-agent-core。*
