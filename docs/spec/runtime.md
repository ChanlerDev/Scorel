# ScorelRuntime — 执行引擎

> 上游：`architecture.md`、`spec/events.md`
> 主题：ScorelRuntime 是纯执行引擎，接收 context 输入，产出 RawRuntimeEvent 流。不持有状态，不负责持久化。

---

## 1. 设计目标

Runtime 只做一件事：**给定 context，驱动 LLM + 工具循环，产出事件流**。

不管：
- 持久化（Daemon 通过 RuntimeBridge 负责）
- 状态管理（SessionTree 负责）
- 并发控制（SessionLane 负责）
- 事件分发（EventBroadcaster 负责）

这种分离让 Runtime 可测试、可复用、职责单一。

---

## 2. 核心变化（相对早期设计）

| 之前 | 之后 |
|------|------|
| Runtime 管理 message history | Runtime 接收 context 作为输入 |
| Runtime 负责持久化 | Daemon 负责持久化（通过 RuntimeBridge） |
| Runtime 输出 ScorelEvent | Runtime 输出 RawRuntimeEvent（无 seq/id） |
| Runtime 有 `prompt()` / `loadMessages()` | Runtime 只有 `executeTurn(context)` |

---

## 3. 接口

```typescript
interface ScorelRuntime {
  /**
   * 执行一轮。接收预构建的 context，返回 raw event generator。
   * 内部处理工具循环直到 turn 结束。
   */
  executeTurn(
    context: ScorelMessage[],
    systemPrompt: string | undefined,
    options: RuntimeTurnOptions
  ): AsyncGenerator<RawRuntimeEvent, void, undefined>;

  cancel(): void;
  readonly running: boolean;

  // 工具注册
  registerTool(tool: ToolDefinition): void;
  unregisterTool(name: string): void;
}
```

---

## 4. RawRuntimeEvent（内部，不导出给消费者）

```typescript
type RawRuntimeEvent =
  | { type: "message_start"; role: "assistant" }
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string; blockIndex: number }
  | { type: "tool_call_delta"; toolCallId: string; toolName?: string; delta: string }
  | { type: "message_end"; message: AssistantMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; partial: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: ToolResultBlock; durationMs: number }
  | { type: "turn_start" }
  | { type: "turn_end"; usage?: Usage; stopReason?: string }
  | { type: "error"; error: Error };
```

RuntimeBridge 负责将 RawRuntimeEvent 转换为统一的 ScorelEvent（分配 id、seq、parentId）。

---

## 5. Persist 策略：有内容就 persist

**规则：只要已生成文本 > 0，无论中断原因都 persist partial。**

| 场景 | 行为 |
|---|---|
| LLM 正常完成 | persist，stopReason: "end_turn" |
| API 错误（有文本） | persist partial，stopReason: "error" |
| 用户 Cancel（有文本） | persist partial，stopReason: "cancelled" |
| 用户 Cancel（无文本） | 不 persist，broadcast message_cancelled (transient) |
| Daemon 崩溃 | 丢失进行中消息（初期可接受） |

Partial message 的 `partial: true` 标记告诉 UI 展示中断状态。buildContext 时当正常 assistant message 使用。

---

## 6. 每步完成立刻 persist

不等整个 turn 结束。Agent loop 中每一步完成就写 JSONL：

```
user message          → 立刻 persist (进入 executeTurn 前)
assistant message_end → 立刻 persist
tool_result 完成      → 立刻 persist
```

这保证任何时刻断线，JSONL 都包含到该步骤为止的完整状态。

---

## 7. Tool Result：per-tool-call 逐条 persist，串行链

一条 assistant message 含多个 tool_use 时，每个工具结果独立 persist 为一条 message event，串行排列（不分叉）：

```
e04: assistant (tool_use[read_a] + tool_use[read_b])   parentId: e03
e05: tool_result (for read_a)                          parentId: e04
e06: tool_result (for read_b)                          parentId: e05
```

pi-ai 的 `transformMessages` 负责跨 provider 格式转换。用户级 rewind 只暴露到 user message 粒度——rewind 到 e04 之前 = e04/e05/e06 全部不在 context 中。

---

## 8. Cancel 时补 error tool_result

LLM 生成了 tool_use 但工具未执行/被中断时，必须补一条 error tool_result 避免 unmatched tool call：

| Cancel 时机 | 行为 |
|---|---|
| 工具正在执行 | 等当前工具原子完成 → persist 正常 result → 不发起下轮 LLM |
| 工具还没开始 | persist error tool_result: `{ isError: true, content: "Cancelled by user" }` |
| Assistant message partial（tool_use JSON 截断） | 只保留 text 部分 persist，不含不完整 tool_use → 不需要补 tool_result |

---

## 9. Steer + FollowUp 双队列

借鉴 pi-mono agent-loop 模式：

| Queue | 消费时机 | 用途 |
|---|---|---|
| steeringQueue | 每次 tool 完成后、下次 LLM 调用前 | 中途插话（"别改了"） |
| followUpQueue | end_turn + steeringQueue 空 | 追加任务（"顺便跑 tests"） |

Loop 逻辑：
```
while (true):
  LLM call → response
  if tool_use → execute tools → drain steeringQueue → continue
  if end_turn → drain steeringQueue
    → if empty → drain followUpQueue
      → has messages → inject as user message, continue
      → both empty → runtime_end
```

### 9.1 Steer 消息的存储与呈现

Steer message persist 为**独立 PersistentEvent**（role = "user"，`meta.source = "steer"`）。

```typescript
// steer persist 为独立 message event
{
  type: "message",
  id: "e14",
  parentId: "e13",  // 挂在当前 tool_result 链之后
  message: {
    role: "user",
    content: "别改了，直接跑测试",
    meta: { source: "steer" }
  }
}
```

**convertToLlm 行为**（由 EventTypeHandler 声明）：

| 前面有 tool_result | 行为 |
|---|---|
| ✅ 有 | `merge_prev` — 合入前一条 tool_result content 末尾，内容为结构化 `system_reminder` block |
| ❌ 没有（idle 状态） | `include` — 作为独立 user message |

Provider lowering 后 LLM 最终看到的（工具循环中）：
```
tool_result: "文件内容...\n\n<system-reminder>\n别改了，直接跑测试\n</system-reminder>"
```

Provider lowering 后 LLM 最终看到的（idle 时）：
```
user: "别改了，直接跑测试"
```

FollowUp 同理：`meta: { source: "followUp" }`。

### 9.2 Steer 在 idle 时

- Runtime 空闲时收到 steer → 等同 send_message，直接触发新 turn
- Runtime 运行中收到 steer → 注入 steeringQueue，下轮开始时消费

---

## 10. RuntimeBridge（Daemon-owned）

RuntimeBridge 是 Daemon 与 Runtime 之间的桥接层。它在本 spec 中作为 integration contract 描述，因为它消费 RawRuntimeEvent；实现归属 `@scorel/daemon`，不能放进 `@scorel/core/runtime`。

Daemon-owned RuntimeBridge 负责：

1. 持久化 user MessageEvent
2. 从 tree 构建 context
3. 调用 runtime.executeTurn(context) 获得 AsyncGenerator
4. 将 raw events 转换为统一事件（预分配 id、分配 seq）
5. 持久化 assistant MessageEvent
6. 如有 tool calls → 执行工具 → 持久化 tool_result MessageEvent → 继续循环

```typescript
interface RuntimeBridge {
  readonly sessionId: SessionId;
  readonly running: boolean;

  /**
   * 执行一轮对话。完整流程见上述 6 步。
   */
  executeTurn(userMessage: UserMessage, options?: SendOptions): Promise<void>;

  cancel(): Promise<void>;
}
```

### 10.1 Runtime 与 Session 关系

- 一个 daemon 可以运行**多个 runtime**
- 每个 runtime 服务**一个 session**（1:1）
- 多个终端同时操作不同 session = 多个并发 runtime
- 同一 session 的多个 client 共享一个 runtime（串行化通过 SessionLane）

---

## 11. Provider Retry 策略

`#runProviderTurn` 内置 provider-neutral 重试循环，覆盖 429/503/5xx、临时网络错误、stream 中断等瞬态故障。重试策略参考 Codex：最多 10 次，前几次等待较短，随后指数退避 + jitter。

### 重试条件

| 条件 | 行为 |
|---|---|
| 无 visible text + retryable error | 重试（指数退避 + jitter） |
| 有 visible text + 任何 error | 不重试（避免不安全重放） |
| AbortError / signal.aborted | 不重试，返回 cancelled |
| 非 retryable error（401/403/400/422、quota/billing、content_filter） | 不重试，立即失败 |
| 重试次数耗尽 | 立即失败 |

### Retryable 分类

- HTTP 408/409/429/500/502/503/504/524
- `x-should-retry: true` header
- 网络错误：`fetch failed`、`ECONNRESET`、`ECONNREFUSED`、`ETIMEDOUT`、`socket hang up` 等
- Stream 中断：`Stream ended without finish_reason`、`stream ended before message_stop` 等
- Provider 超载：`overloaded`、`rate limit`、`too many requests` 等

### 非 Retryable 分类

- AbortError / 用户取消
- HTTP 400/401/403/404/422/451
- `x-should-retry: false` header
- Quota/billing：`insufficient_quota`、`quota exceeded`、`billing` 等
- Content filter / safety

### Backoff 策略

```
baseDelayMs: 500     (首次重试 ~375–500ms)
maxDelayMs:  30_000  (上限 30s)
jitterFactor: 0.25   (delay * (1 – random * 0.25))
```

延迟序列（jitter 前）：0.5s, 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s, 30s。

`Retry-After` / `retry-after-ms` header 优先于指数退避计算，但同样受 `maxDelayMs` 上限约束。

### 安全保证

- 重试只在 **无 visible text** 时发生（thinking-only 或完全空）。
- 工具执行在 `streamTurn` 返回后由 runtime 驱动，重试不会在工具执行后重复。
- `AbortSignal` 在 backoff sleep 期间有效，取消立即生效。
- Thinking deltas 在重试时重置（不影响用户可见输出）。

### 配置

`ScorelRuntime` 构造器接受可选 `retryConfig: ProviderRetryConfig`，默认值为上述策略。测试可注入短延迟配置。

---

## 12. 初期范围与延后项

**初期落地**
- ScorelRuntime 接口 + executeTurn
- RawRuntimeEvent → ScorelEvent 转换（daemon-owned RuntimeBridge）
- Persist 策略（partial persist + per-step persist）
- Cancel 处理（补 error tool_result）
- steeringQueue + followUpQueue 双队列

**延后**
- 工具并行执行优化（初期串行安全优先）
- Runtime 资源限制（timeout per-turn、token budget）
- 更深嵌套 subagent（当前 depth=1）
- 工具并行执行以外的跨 session 调度策略

---

*Runtime 是纯函数式执行引擎。给 context，出 events。状态、持久化、分发全部外置。*
