# d000 — Scorel 基础架构

> *"pi-ai 处理协议，pi-agent-core 处理循环，Scorel 处理资产与生态。"*
> *"一切时间旅行都是 Replay 的一种姿势。"*

---

## 0. 本文档的位置

本文档是 Scorel 从 0 到 1 阶段的 **基础架构稿**，负责三件事：

1. 说清 Scorel 在 pi-ai / pi-agent-core 栈中的定位
2. 给出分层结构与数据流
3. 作为其他设计稿的目录与总纲

具体模块的机制不在这里展开，读者需要看某一块的设计细节时，请跳到对应文档：

| 文档 | 主题 |
|------|------|
| `d001-session.md` | Session 存储、Rewind、File Checkpoint、压缩（围绕 Event Sourcing + Replay） |
| `d002-channel.md` | Channel 统一入口：CLI / HTTP / IM / Cron 的归一模型 |
| `d003-tools.md` | 工具系统、内置工具集、MCP 集成 |
| `d004-extensions.md` | Hooks、Extensions、System Prompt 组装、配置系统 |

---

## 1. 系统定位

Scorel 是构建在 **pi-ai + pi-agent-core** 之上的 **应用层编排平台**：

- **底层协议**交给 pi-ai：10+ provider 统一接入、跨 provider 消息转换（`transformMessages`）、流式事件、模型目录
- **Agent Loop**交给 pi-agent-core：单轮推理 + 多轮工具执行 + 生命周期 hook
- **Scorel 自己做三件事**：
  1. **把对话变成资产**：append-only JSONL + Replay 架构，rewind / fork / file checkpoint 统一用一套机制
  2. **多端多 Channel 的统一接入**：CLI / GUI / Cloud Daemon / IM Bridge 共享同一个 Session 和同一套语义
  3. **扩展生态**：Hooks、Extensions、MCP 分级加载（Skills、Memory 为后期）

### 1.1 核心设计决策

| 决策 | 说明 |
|------|------|
| Agent Loop 复用 pi-agent-core | 循环、工具调度、生命周期 hook 由 pi-agent-core 提供，Scorel 不自建 |
| 事件协议沿用 pi-agent-core 的 11 种事件 | 直接订阅，不另造一套语义 |
| Provider 分层依赖 pi-ai 的 `Api/Provider/Model` | 不再在上层叠 Runtime/Transport/Provider 三层 |
| 跨 provider 消息转换交给 pi-ai 的 `transformMessages` | 脏活不自己干 |
| 单一 Agent 入口 | 特殊形态（如 CLI 包装型 Agent）作为可选 Extension，主路径保持精简 |
| Event Sourcing + Replay | Rewind / Fork / File Checkpoint / Compact 共享同一个 replay 函数 |

---

## 2. 分层结构

```
┌─────────────────────────────────────────────────────────┐
│  Apps Layer                                             │
│  ├── apps/cli      REPL + 斜杠命令                       │
│  ├── apps/gui      Tauri 桌面端（后期）                  │
│  └── apps/cloud    HTTP API + IM Bot 通道（后期）        │
├─────────────────────────────────────────────────────────┤
│  Scorel Core                                            │
│  ├── session/      JSONL append-only + Replay   (d001)  │
│  ├── checkpoint/   File snapshot                (d001)  │
│  ├── compaction/   上下文压缩                    (d001)  │
│  ├── channel/      外部消息注入适配器            (d002)  │
│  ├── tools/        内置工具 + MCP               (d003)   │
│  ├── hooks/        原生 hook + 广播事件          (d004)  │
│  ├── extensions/   扩展加载与错误隔离            (d004)  │
│  ├── prompt/       System Prompt 组装            (d004)  │
│  └── config/       TOML 多层配置                 (d004)  │
├─────────────────────────────────────────────────────────┤
│  pi-agent-core   Agent Loop + Tool Execution + Events   │
├─────────────────────────────────────────────────────────┤
│  pi-ai           Provider Protocol + transformMessages  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 数据流

```
外部输入（CLI / HTTP / IM / cron）
    ↓
ChannelAdapter 归一化为 AgentMessage                    ← d002
    ├→ Agent 空闲 → agent.prompt(msg)
    └→ Agent 运行中 → agent.steer(msg) 入队
    ↓
pi-agent-core runLoop
    │
    ├── transformContext(messages)            ← Scorel 拦截：     d001 / d004
    │     ├── replayRewinds(messages)            1. 解析 rewind 标记
    │     └── compactIfOverThreshold(messages)   2. 超阈值触发压缩
    │
    ├── convertToLlm(messages)                ← Scorel 拦截：     d001
    │     └── 过滤 rewind / file_snapshot / channel_metadata 等自定义消息
    │
    ├── pi-ai.streamSimple(model, context)
    │     └── transformMessages                ← pi-ai 内部：跨 provider 转换
    │
    ├── 工具调度
    │     ├── beforeToolCall                  ← Scorel 拦截：FileCheckpoint   d001
    │     ├── tool.execute()
    │     └── afterToolCall
    │
    └── agent.subscribe(event)
          ├→ UI 渲染（message_update / tool_execution_*）
          ├→ SessionStore.append(event)      ← 同步写 JSONL      d001
          └→ ExtensionRunner.emit(event)      ← 扩展广播          d004
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

2. **Event Sourcing：一切时间旅行都是 Replay**
   - Rewind / Fork / File Checkpoint / Compact 都是同一个 replay 函数的不同输入
   - JSONL 永不删除，一切历史可追溯、可调试、可审计

3. **两层消息，清晰隔离**
   - 应用层（`AgentMessage`）：存储 / UI / Extension 看得到一切
   - LLM 层（`Message`）：LLM 只看到 `convertToLlm` 过滤后的干净版本
   - 自定义消息类型随便加，不污染 LLM

4. **Channel 归一：任何输入都是 AgentMessage**
   - IM / cron / CLI / GUI 没有本质区别
   - 用 `<system_reminder>` XML 让 LLM 分辨来源和转达

5. **核心做减法，扩展做加法**
   - 核心只保留最通用机制（Session / Channel / Hook / Config）
   - Extension / MCP / Skill 做定制化，出错不影响核心

---

## 6. 实现原则

1. **pi 栈优先**：能用 pi-ai / pi-agent-core 做的，绝不自己写
2. **错误是数据，不是异常**：pi-ai 的工具错误、LLM 错误都被编码成 `AssistantMessage` 的 stopReason，不抛异常
3. **Event Sourcing 贯穿始终**：任何状态变更必须先 append 到 JSONL，内存状态由 replay 推导
4. **两层消息绝不混用**：自定义消息只存在于应用层，`convertToLlm` 是唯一边界
5. **Extension 错误隔离**：单个扩展失败必须不阻塞核心和其他扩展
6. **版本包一层**：所有 `@mariozechner/pi-*` 的类型重新 export 成 Scorel 命名空间，未来换底层只改 adapter 层

---

## 7. 参考项目

| 来源 | 借鉴点 |
|------|--------|
| **pi-mono** (`pi-ai` / `pi-agent-core`) | 直接依赖：Provider 协议、Agent Loop、11 种事件、4 个 hook、Steering/FollowUp |
| **Claude Code** | Append-only JSONL + Replay、Rewind 通过 marker 而非删除、`<system_reminder>` 注入、斜杠命令 |
| **Bub** (learn-claude-code) | Harness 哲学、Tape-based 上下文；Subagent / Skills 为后期借鉴 |
| **Hermes Agent** | Memory System（后期）、Prompt Caching 保护、Profile 多实例（后期） |
| **CodePilot** | 保守并行（只读工具才并行）、结构化错误、Bridge → Channel 抽象 |

---

## 8. 架构风险

| 风险 | 说明 | 缓解 |
|------|------|------|
| **pi-agent-core 单人维护** | 上游维护者 bus factor = 1 | Scorel 包一层 adapter；版本冻结策略；必要时 fork |
| **pi-\* 包版本紧耦合** | pi-ai 和 pi-agent-core 版本必须同步 | 依赖范围锁死到 patch 级，更新前先跑回归 |
| **Steering 不能 mid-turn 打断** | 工具执行中用户插话要等工具完成 | UX 承诺 "等待当前工具"，长工具用 `abort()` 兜底 |
| **TypeBox vs Zod 不兼容** | MCP 生态常见 Zod | 写 TypeBox ↔ JSON Schema 转换层（pi-ai 已有 `convertJsonSchemaToTypeBox`） |
| **Event Sourcing 的 JSONL 膨胀** | 长 session 文件会很大 | Compact 标记 + 旧 snapshot 归档到 `.archive/`（后期） |

---

*架构核心：Event Sourcing + Replay，两层消息分离，Channel 归一，底层依赖 pi-ai + pi-agent-core。*
