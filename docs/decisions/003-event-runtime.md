# ADR-003：事件系统运行时行为

**状态**：已确认
**日期**：2026-05-23
**参与者**：Chanler, Claude

## 背景

d006 定义了统一事件模型（PersistentEvent + TransientEvent），但以下运行时行为未明确：

- 断线/错误/取消时的持久化策略
- 同步机制的具体算法
- 多工具调用时的 persist 粒度
- Steer/FollowUp 双队列的消费时机
- Compact 与 Rewind 的交互规则
- 环形缓冲的作用域和大小策略

本 ADR 锁定这些决策。

## 决策

### 1. Persist 策略：有内容就 persist

**规则：只要已生成文本 > 0，无论中断原因都 persist partial。**

| 场景 | 行为 |
|---|---|
| LLM 正常完成 | persist，stopReason: "end_turn" |
| API 错误（有文本） | persist partial，stopReason: "error" |
| 用户 Cancel（有文本） | persist partial，stopReason: "cancelled" |
| 用户 Cancel（无文本） | 不 persist，broadcast message_cancelled (transient) |
| Daemon 崩溃 | 丢失进行中消息（初期可接受） |

Partial message 的 `partial: true` 标记告诉 UI 展示中断状态。buildContext 时当正常 assistant message 使用。

### 2. 每步完成立刻 persist

不等整个 turn 结束。Agent loop 中每一步完成就写 JSONL：

```
user message          → 立刻 persist (进入 executeTurn 前)
assistant message_end → 立刻 persist
tool_result 完成      → 立刻 persist
```

这保证任何时刻断线，JSONL 都包含到该步骤为止的完整状态。

### 3. Tool Result：per-tool-call 逐条 persist，串行链

一条 assistant message 含多个 tool_use 时，每个工具结果独立 persist 为一条 message event，串行排列（不分叉）：

```
e04: assistant (tool_use[read_a] + tool_use[read_b])   parentId: e03
e05: tool_result (for read_a)                          parentId: e04
e06: tool_result (for read_b)                          parentId: e05
```

pi-ai 的 `transformMessages` 负责跨 provider 格式转换。用户级 rewind 只暴露到 user message 粒度——rewind 到 e04 之前 = e04/e05/e06 全部不在 context 中。

### 4. Cancel 时补 error tool_result

LLM 生成了 tool_use 但工具未执行/被中断时，必须补一条 error tool_result 避免 unmatched tool call：

| Cancel 时机 | 行为 |
|---|---|
| 工具正在执行 | 等当前工具原子完成 → persist 正常 result → 不发起下轮 LLM |
| 工具还没开始 | persist error tool_result: `{ isError: true, content: "Cancelled by user" }` |
| Assistant message partial（tool_use JSON 截断） | 只保留 text 部分 persist，不含不完整 tool_use → 不需要补 tool_result |

### 5. Steer + FollowUp 双队列

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

Steer message persist 为普通 user message（clientId 标记来源），LLM 正常看到并自行决策。

### 6. seq 为 per-session

每个 session 独立维护 seq 递增序列。Client 的 lastSeq 只在当前 session 有意义。

理由：
- 避免多 session 并发时快速消耗共享缓冲
- session 切换时不需要 seq 映射
- Client 只关心自己 session 的事件

### 7. 环形缓冲：per-active-session，字节上限

| 配置 | 默认值 | 说明 |
|---|---|---|
| 作用域 | per-active-session | 每个活跃 session 独立缓冲 |
| 大小上限 | 2MB | 按序列化后字节计算 |
| 淘汰策略 | FIFO | 最旧的先淘汰 |
| session 不活跃时 | 释放缓冲 | 重新激活时从 JSONL 加载 |

缓冲存在的意义：让短暂断网（秒级）的 client 无缝续上流式体验。不为长时间断线设计。

### 8. 同步算法三级 fallback

Client 重连报 `lastSeq`：

1. **缓冲命中**：`lastSeq` 在 buffer 范围内 → 补发全部事件（persistent + transient）→ 完美续流
2. **缓冲 miss**：从 JSONL 补发 `seq > lastSeq` 的 persistent events → 状态完整，丢失流式动画
3. **Runtime 进行中**：额外发送 `message_start { eventId, partial: "已累积文本" }` → Client 接上当前生成

Transient events 丢失不影响正确性——最终完整消息在 PersistentEvent 里。

### 9. Rewind 不跨 Compact

Compact event 是硬边界。`rewind(targetId)` 时检查 path：

- target 在最近 compact 之后 → 允许
- target 在 compact 之前 → 拒绝（返回 error: "cannot_rewind_past_compact"）

Compact 之前的事件保留在 JSONL 中供审计查阅，但不可回退到、UI 不展示。

### 10. Transport 保持三种独立实现

| Transport | 安全模型 | 场景 |
|---|---|---|
| EmbeddedTransport | 无需（进程内） | CLI/GUI 单用户，Daemon 随进程生死 |
| SocketTransport | 文件系统权限 | 本地多 Entry 共享 |
| WsTransport | TLS + token auth | 远端 VPS / 浏览器 WebUI |

共享 `DaemonTransport` interface。不合并 Socket/WS 因为：安全模型不同、浏览器只能用 WS、错误模式不同、重连策略不同。

## 否决的方案

1. **全局 seq 共享所有 session** — 多 session 并发时缓冲消耗过快，session 切换时 lastSeq 语义混乱
2. **合并所有 tool_result 为一条 event** — crash 时丢全部工具结果；与 pi-ai ToolMessage 格式不一致
3. **Cancel 时丢弃所有已生成内容** — 用户已看到文本突然消失 = 糟糕 UX
4. **Rewind 允许跨 compact** — compact 存在就是因为 context 太长，跨过去又变长
5. **环形缓冲按条数限制** — 事件大小差异大（text_delta vs tool_result with 大文件），按字节更公平
6. **合并 SocketTransport / WsTransport 为一个 NetworkTransport** — 安全模型、错误模式、重连策略完全不同；浏览器不能连 Unix socket；合并只是表面统一实际内部分支更复杂

## 参考

- pi-mono agent-loop.ts: steeringQueue + followUpQueue 双队列模式
- pi-mono agent.ts: PendingMessageQueue drain modes ("all" / "one-at-a-time")
- Claude Code: Cancel 后保留 partial response
