# 统一事件模型

> 上游：`architecture.md`
> 主题：统一事件模型——JSONL 持久化 = 远程同步 = 本地状态驱动，一套机制覆盖全部。

---

## 1. 设计目标

当前实现的根本问题：**事件和存储是两套东西**。

- Runtime 事件（10 种，纯瞬态）→ 用于 UI 流式渲染
- LogEntry（4 种，持久化）→ 用于 JSONL 存储

这导致：
- Rewind/Branch 不是事件，无法同步给远端 client
- 没有 deviceId（谁做的操作？）
- 本地持久化和远程同步是两条路径

**目标：统一它们。**

核心公式：`JSONL 中的一行 = 一个 PersistentEvent = 远程同步的一个单元`

---

## 2. 两层事件模型

| 层 | 持久化 | 广播 | 有 id+parentId | 有 seq |
|---|---|---|---|---|
| **PersistentEvent** | ✅ 写入 JSONL | ✅ 广播所有 client | ✅ 构成树 | ✅ |
| **TransientEvent** | ❌ 不存储 | ✅ 广播所有 client | ❌ | ✅ |

**为什么分两层而不是全部持久化？**

流式 delta 每秒产生几十上百条，全部写 JSONL 会导致：
1. 文件膨胀 10-100x
2. 重连 replay 时间暴增
3. 对 LLM context 无意义

所以：**改变状态的 → 持久化；传递过程信息的 → 仅广播**。

---

## 3. 公共字段

### 3.1 身份模型

| 概念 | 含义 | 粒度 | 示例 |
|------|------|------|------|
| `deviceId` | Daemon 运行在哪台机器，session 的物理归属 | Session 级（SessionHeader） | `"vps-tokyo-01"` |
| `clientId` | 哪个连接端发起的操作 | Event 级（每个 event） | `"gui-mac-chanler"` / `"tg-bot-001"` |
| `sessionId` | 会话唯一标识 | Session 级 | `"ses_x7k2m"` |

**核心原则**：Session 属于 device（daemon 宿主机）。多个 client 连接到同一个 session，共享同一份数据。如果想把 session 搬到另一台机器，用 fork。

### 3.1.1 ID 与序号规则

随机稳定 ID 和单调序号分工明确：

- `sessionId`：默认由 daemon 随机生成（UUID / ULID / nanoid 均可），用于协议和存储引用；用户可读名称放在 title / meta，不把手写名称当主 ID。
- `event.id`：persistent event 的随机稳定 ID，不使用自增；tree、去重、transient finalization 都依赖它。
- `deviceId`：每台 daemon 宿主持久生成一次，重启后保持稳定；remote mirror 用它判断 session 物理归属。
- `clientId`：client 连接端 ID，可按 profile 持久或按连接生成；它用于审计/展示，不决定 session 权威。
- `seq`：每个 session 内由 daemon 单调递增，persistent 和 transient 共享；它只表达顺序和 reconnect anchor，不作为全局身份。
- UI 短号 / 本机 index：可以自增，但只服务本机选择和展示，不能进入协议身份。

因此，`sessionId` 需要尽量全局不碰撞；`seq` 才是适合自增的 per-session 顺序号。

### 3.2 PersistentEvent 基础结构

```typescript
interface PersistentEventBase {
  id: EventId;              // 唯一标识，nanoid
  parentId: EventId | null; // 树结构（null = 第一个事件）
  seq: Seq;                 // Daemon 分配的递增序号（用于同步）
  sessionId: SessionId;     // 所属 session
  clientId: ClientId;       // 哪个 client 发起的操作
  ts: number;               // epoch ms
}
```

### 3.3 TransientEvent 基础结构

```typescript
interface TransientEventBase {
  seq: Seq;                 // 与 PersistentEvent 共享同一个递增序列
  sessionId: SessionId;
  clientId: ClientId;       // 哪个 client 触发的
  ts: number;
}
```

**关键**：seq 是 per-session 统一递增的，PersistentEvent 和 TransientEvent 共享同一个序列。这意味着 client 通过 `lastSeq` 可以精确知道自己漏了哪些事件（无论类型）。

---

## 4. PersistentEvent 类型（8 种）

### 4.1 `message` — 对话内容

```typescript
interface MessageEvent extends PersistentEventBase {
  type: "message";
  message: ScorelMessage;  // user | assistant | tool_result | internal
}
```

最核心的事件。用户输入、助手回复、工具结果都是 message 事件。

### 4.2 `rewind` — 回退到某个点

```typescript
interface RewindEvent extends PersistentEventBase {
  type: "rewind";
  targetEventId: EventId;  // 回退到哪个事件（新的 active leaf）
}
```

Rewind 本身也是一个事件节点，记录在树上。回退后，新消息 attach 到 `targetEventId`（而不是 rewind 事件本身）。

### 4.3 `branch` — 切换到另一个分支叶子

```typescript
interface BranchEvent extends PersistentEventBase {
  type: "branch";
  leafEventId: EventId;    // 要导航到的叶子
}
```

与 rewind 区别：rewind 是"回到过去重新来"，branch 是"切换到已有的另一条分支"。

### 4.4 `compact` — 压缩上下文

```typescript
interface CompactEvent extends PersistentEventBase {
  type: "compact";
  summary: string;                // 摘要文本
  compactedThrough: EventId;      // 到此事件为止的内容被压缩
  tokensBefore: number;           // 压缩前 token 数
  tokensAfter: number;            // 压缩后 token 数
}
```

构建 context 时：从 leaf 往 root 走，遇到 CompactEvent → 注入 summary，停止继续向上。旧事件仍在 JSONL 中（可查阅），但不进入 LLM context。

### 4.5 `channel_inject` — 外部来源元数据

```typescript
interface ChannelInjectEvent extends PersistentEventBase {
  type: "channel_inject";
  channel: string;            // "telegram" | "wechat" | "cron" | "webhook"
  externalId: string;         // 外部系统中的 ID
  metadata?: Record<string, unknown>;
}
```

紧跟一个 MessageEvent。标记"这条消息来自 Telegram 群"。不进入 LLM context，仅审计用。

### 4.6 `session_info` — 元数据变更

```typescript
interface SessionInfoEvent extends PersistentEventBase {
  type: "session_info";
  changes: Partial<SessionMeta>;  // 只记 delta
}
```

模型切换、thinking level 变更、session 重命名等。累积 fold 所有 session_info 事件得到当前配置。

### 4.7 `custom` — 扩展数据（不进入 LLM context）

```typescript
interface CustomEvent extends PersistentEventBase {
  type: "custom";
  kind: string;          // 扩展命名空间
  data: unknown;
}
```

Extension 用于存储自己的状态（书签、标注等）。Session reload 时 extension 扫描 `kind` 重建状态。

### 4.8 `custom_message` — 扩展数据（进入 LLM context）

```typescript
interface CustomMessageEvent extends PersistentEventBase {
  type: "custom_message";
  kind: string;
  message: ScorelMessage;     // LLM 能看到的内容
  data?: unknown;             // 不给 LLM 的元数据
}
```

用于 RAG 注入、动态指令、记忆召回等。构建 context 时和普通 message 一样被包含。

---

## 5. TransientEvent 类型（12 种）

### 5.1 `message_start` — 预分配事件 ID

```typescript
interface MessageStartEvent extends TransientEventBase {
  type: "message_start";
  eventId: EventId;            // 预分配 → 最终 MessageEvent 使用同一个 id
  parentId: EventId | null;    // 最终在树上的位置
  role: "assistant" | "tool_result";
  model?: string;
}
```

**核心机制**：生成开始时就分配 id，后续所有 delta 引用它。Client 收到最终的 PersistentEvent(MessageEvent) 时，用 id 匹配替换 transient buffer。

### 5.2 流式 delta（3 种）

```typescript
interface TextDeltaEvent extends TransientEventBase {
  type: "text_delta";
  eventId: EventId;      // 引用 message_start 的 eventId
  delta: string;
}

interface ThinkingDeltaEvent extends TransientEventBase {
  type: "thinking_delta";
  eventId: EventId;
  delta: string;
  blockIndex: number;    // 多个 thinking block 时区分
}

interface ToolCallDeltaEvent extends TransientEventBase {
  type: "tool_call_delta";
  eventId: EventId;      // 引用 assistant message 的 eventId
  toolCallId: string;    // 这个 tool call 的唯一 id
  toolName?: string;     // 第一个 delta 包含名称
  delta: string;         // JSON 参数片段
}
```

### 5.3 工具执行（3 种）

```typescript
interface ToolExecutionStartEvent extends TransientEventBase {
  type: "tool_execution_start";
  eventId: EventId;      // 预分配 → 工具结果 MessageEvent 使用同一个 id
  parentId: EventId;     // 工具结果将挂在哪里
  toolCallId: string;
  toolName: string;
  args: unknown;
}

interface ToolExecutionUpdateEvent extends TransientEventBase {
  type: "tool_execution_update";
  eventId: EventId;
  toolCallId: string;
  partial: unknown;      // 工具特定的中间输出
}

interface ToolExecutionEndEvent extends TransientEventBase {
  type: "tool_execution_end";
  eventId: EventId;
  toolCallId: string;
  toolName: string;
  durationMs: number;
  isError: boolean;
}
```

### 5.4 生命周期（4 种）

```typescript
interface TurnStartEvent extends TransientEventBase {
  type: "turn_start";
  turnIndex: number;
}

interface TurnEndEvent extends TransientEventBase {
  type: "turn_end";
  turnIndex: number;
  usage?: Usage;
  stopReason?: string;
}

interface RuntimeStartEvent extends TransientEventBase {
  type: "runtime_start";
}

interface RuntimeEndEvent extends TransientEventBase {
  type: "runtime_end";
  error?: string;
  reason: "completed" | "cancelled" | "error";
}
```

### 5.5 `message_cancelled` — 取消清理

```typescript
interface MessageCancelledEvent extends TransientEventBase {
  type: "message_cancelled";
  eventId: EventId;      // 预分配了但不会被持久化的 id
  reason: "user_cancel" | "error" | "max_tokens";
}
```

用户取消生成时，预分配的 id 永远不会出现在 PersistentEvent 中。此事件告诉 client 清理 transient buffer。

---

## 6. EventTypeHandler：双 Converter 模式

每种 PersistentEvent 类型注册两个 converter，决定该事件在不同消费场景下的呈现方式。核心逻辑（buildContext / UI 渲染）不 hardcode 任何事件类型的特殊行为——全靠 handler 声明。

### 6.1 接口

```typescript
interface EventTypeHandler<T extends PersistentEvent> {
  /** 构建 LLM context 时：这条事件怎么变成（或合入）LLM 消息 */
  convertToLlm(event: T, ctx: LlmConvertContext): LlmAction;

  /** 展示给用户时：这条事件怎么渲染 */
  convertToDisplay(event: T, ctx: DisplayContext): DisplayAction;
}
```

### 6.2 LlmAction

```typescript
type LlmAction =
  | { action: "include"; message: ScorelMessage }       // 正常包含为一条消息
  | { action: "merge_prev"; content: string }           // 合入前一条消息（<system-reminder> 包裹）
  | { action: "skip" }                                  // 不包含在 LLM context 中
  | { action: "barrier"; summary: ScorelMessage }       // 替换上方所有消息，注入 summary，停止遍历
```

### 6.3 各事件类型的 Handler 行为

| Event 类型 | convertToLlm | convertToDisplay |
|---|---|---|
| `message`（user/assistant/tool_result） | `include` — 原样包含 | 正常气泡 |
| `message`（meta.source = "steer"） | `merge_prev` — 合入前一条 tool_result 的 `<system-reminder>`；无 tool_result 则 `include` 作为独立 user msg | 内联小字提示 |
| `message`（meta.source = "followUp"） | 同 steer | 内联 "追加任务" 标记 |
| `rewind` | `skip` | "回退到此处" 标记 |
| `branch` | `skip` | "切换分支" 标记 |
| `compact` | `barrier` — 注入 summary，停止向上遍历 | "已压缩" 折叠块 |
| `channel_inject` | `skip` | 来源 badge "from Telegram" |
| `session_info` | `skip` | "模型切换为 X" 通知 |
| `custom` | `skip` | Extension 自定义 |
| `custom_message` | `include` — 包含 message | Extension 自定义 |

### 6.4 buildContext 通用遍历

```typescript
function buildContext(tree: SessionTree, leafId: EventId): ScorelMessage[] {
  const path = tree.getPath(leafId);  // root → leaf
  const messages: ScorelMessage[] = [];

  // 从 leaf 往 root 走
  for (let i = path.length - 1; i >= 0; i--) {
    const event = tree.get(path[i])!.event;
    const handler = getHandler(event.type);
    const result = handler.convertToLlm(event, ctx);

    switch (result.action) {
      case "include":
        messages.unshift(result.message);
        break;
      case "merge_prev":
        // 合入 messages 中最后一条 tool_result 的 content 末尾
        mergeIntoPrevToolResult(messages, result.content);
        break;
      case "skip":
        break;
      case "barrier":
        messages.unshift(result.summary);
        return messages;  // 停止遍历
    }
  }
  return messages;
}
```

**核心不 hardcode 任何事件类型**。新增事件类型只需注册 handler。

---

## 7. `<system-reminder>` 通用 Harness 注入机制

### 7.1 用途

`<system-reminder>` 是 Scorel harness 向 LLM 传递旁路信息的统一格式。所有非用户直接输入、但需要 LLM 看到的系统级内容都用此标签包裹。

### 7.2 使用场景

| 场景 | 注入内容 | 注入位置 |
|------|---------|---------|
| Steer（用户中途插话） | 用户的引导文字 | merge 进前一条 tool_result |
| Hook 上下文（UserPromptSubmit 等） | hook 产出 | user message / tool_result 末尾 |
| Memory 召回 | 记忆内容 | tool_result 末尾 |
| 系统提醒（超时、配额等） | 通知文本 | tool_result 末尾 |
| Channel 来源标注 | 来自哪个群/频道 | user message 内 |

### 7.3 格式

```xml
<system-reminder>
内容
</system-reminder>
```

### 7.4 注入规则

- **工具循环中**：merge 进最近一条 tool_result 的 content 末尾
- **无 tool_result 时（idle / turn 结束后）**：作为独立 user message（或附加到 user message 内）

### 7.5 LLM System Prompt 声明

LLM 在 system prompt 中被告知：

> Tool results and user messages may include `<system-reminder>` tags. These contain information from the system and bear no direct relation to the specific tool results or user messages in which they appear.

这确保 LLM 不会把 `<system-reminder>` 内容误解为工具输出或用户直接发言。

---

*统一事件模型的核心洞察：JSONL 中的一行 = 一个可同步的状态变更。本地持久化和远程同步共享同一个机制，不再是两套系统。EventTypeHandler 双 converter 让每种事件自声明行为，核心遍历逻辑无需 hardcode。*
