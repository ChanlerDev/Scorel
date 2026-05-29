# Session — 会话资产与树状存储

> 上游：`architecture.md`、`spec/events.md`
> 主题：把对话、工具调用、文件修改全部收敛到一条 append-only JSONL 上，所有"时间旅行"都是同一个 `replay` / `buildContext` 函数的不同输入。

---

## 1. 设计目标

Scorel 不把会话当做"可丢的上下文"，而当做**资产**。资产的核心要求有三条：

1. **不丢失**：JSONL 只追加、不修改，任何历史都可被重建
2. **可重放**：Rewind、Fork、Compact 等能力都通过同一个机制从 JSONL 推导出目标状态
3. **可隔离**：会话中的"自定义记录"（rewind 标记、channel 元数据）只存在于应用层，LLM 永远看不到（由 `convertToLlm` 在边界上过滤）

这三条要求共同决定了架构形状：**单一日志 + 树状结构 + 两层消息**。

---

## 2. JSONL 格式（v1）

### 2.1 文件结构

```
~/.scorel/sessions/{sessionId}.jsonl
```

- 第 0 行：SessionHeader
- 第 1+ 行：PersistentEvent（每行一个 JSON）

### 2.2 SessionHeader

```typescript
interface SessionHeader {
  version: 1;
  sessionId: SessionId;
  deviceId: DeviceId;      // daemon 宿主机，session 的物理归属
  createdAt: number;
  clonedFrom?: {           // 如果是从另一个 session clone 来的
    sessionId: SessionId;
    deviceId: DeviceId;
    eventId: EventId;      // clone 自哪个事件
  };
  meta: SessionMeta;
}

interface SessionMeta {
  name?: string;
  title?: string;
  model: string;
  thinkingLevel: "none" | "low" | "medium" | "high";
  [key: string]: unknown;  // 可扩展
}
```

`sessionId` 是随机稳定身份，不承担用户可读命名。产品 UI / CLI 应优先展示 `title`、时间、project、short index；short index 只允许作为本机选择辅助，不作为跨 daemon 协议 ID。测试和调试路径可以显式传入 `--session <id>`，但默认新建 session 应由 daemon 生成随机 ID。

### 2.3 示例文件

```jsonl
{"version":1,"sessionId":"ses_abc","deviceId":"vps-tokyo-01","createdAt":1716000000000,"meta":{"model":"claude-sonnet-4-20250514","thinkingLevel":"medium"}}
{"type":"message","id":"e01","parentId":null,"seq":1,"sessionId":"ses_abc","clientId":"gui-mac-chanler","ts":1716000001000,"message":{"role":"user","content":"解释 monads"}}
{"type":"message","id":"e02","parentId":"e01","seq":5,"sessionId":"ses_abc","clientId":"daemon","ts":1716000005000,"message":{"role":"assistant","content":[{"type":"text","text":"Monad 是..."}],"model":"claude-sonnet-4-20250514","stopReason":"end_turn","usage":{"inputTokens":150,"outputTokens":420}}}
{"type":"message","id":"e03","parentId":"e01","seq":10,"sessionId":"ses_abc","clientId":"tg-bot-001","ts":1716000010000,"message":{"role":"user","content":"用更简单的话解释"}}
{"type":"rewind","id":"e04","parentId":"e03","seq":15,"sessionId":"ses_abc","clientId":"gui-mac-chanler","ts":1716000015000,"targetEventId":"e01"}
{"type":"message","id":"e05","parentId":"e01","seq":16,"sessionId":"ses_abc","clientId":"gui-mac-chanler","ts":1716000016000,"message":{"role":"user","content":"解释 functor 吧"}}
```

注意：
- SessionHeader 有 `deviceId`（session 归属机器）
- 每个 event 有 `clientId`（谁发起的操作）
- assistant 消息的 `clientId` 是 `"daemon"`（runtime 自己产生的）
- Telegram bot 注入的消息 `clientId` 是 `"tg-bot-001"`

### 2.4 树可视化

```
e01 (user: "解释 monads")                    ← parentId: null
 ├── e02 (assistant: "Monad 是...")          ← parentId: e01
 │    └── e03 (user: "用更简单的话解释")      ← parentId: e02（这条后来被 rewind 了）
 │         └── e04 (rewind → e01)            ← 审计记录，死端
 └── e05 (user: "解释 functor 吧")           ← parentId: e01（rewind 后新消息）
```

注意：
- `e04`（rewind）记录在树上但不影响 context building
- `e05` 的 parentId 是 `e01`（rewind 的 target），不是 `e04`
- `seq` 不连续（中间是 transient events 占的序号）

### 2.5 Attach Client Cache

Daemon-owned JSONL remains the authoritative session store. Attach clients may keep a local project-scoped persistent cache to speed up terminal recovery, but that cache is not a second writer.

Cache scope is part of the identity:

- local attach cache is scoped under a local project locator
- remote attach cache is scoped under a remote `deviceId + projectSlug`
- same `sessionId` under different scopes must not share cache files

The remote endpoint URL is a connection locator, not stable identity. If a daemon reports the same `deviceId + projectSlug` after the URL changes, attach should reuse the same cache. A daemon may also provide a `deviceDisplayName` for UI labels, but display names are not identity.

The cache may advance `persistentLastSeq` only after a persistent event has been durably written to the local cache. It must not advance persistent anchors from transient events. If metadata no longer matches the requested attach target, the client must ignore or isolate the cache and perform daemon reconciliation.

If the cache stores transient stream state, it must be explicitly separate from persistent events. A cached transient may advance `streamLastSeq`, but it is provisional UI state only and must be discarded once the matching persistent assistant event is observed.

### 2.6 Session Diagnostics Log

Each daemon-owned session may also have a sibling plain-text diagnostics log:

```text
~/.scorel/sessions/{sessionId}.jsonl
~/.scorel/sessions/{sessionId}.log
```

The `.log` file is append-only operational evidence, not replay state. It is written by the daemon that owns the session JSONL and stays on that machine. Remote attach must not copy daemon diagnostics into local attach cache.

Each log line is human-readable and grep-friendly:

```text
ts=1716000000000 level=info event=send_message_started sessionId=ses_abc clientId=client_cli
ts=1716000000100 level=error event=runtime_error sessionId=ses_abc message="stream closed before response.completed"
```

Diagnostics can record lifecycle, reconnect, runtime, provider result summaries, and errors. They must not record API keys, bearer tokens, full prompts, full tool results, or raw provider payloads by default.

---

## 3. SessionTree 与 Context 构建

### 3.1 树接口

```typescript
interface SessionTree {
  get(id: EventId): TreeNode | undefined;
  has(id: EventId): boolean;
  append(event: PersistentEvent): void;

  readonly rootId: EventId | null;
  getLeaves(): EventId[];
  getChildren(id: EventId): EventId[];
  getPath(id: EventId): EventId[];  // root → node
  getBranchPoints(): EventId[];      // 有多个 children 的节点

  readonly size: number;
  [Symbol.iterator](): Iterator<PersistentEvent>;
}

interface TreeNode {
  event: PersistentEvent;
  children: EventId[];
}
```

### 3.2 Context 构建算法

buildContext 使用 EventTypeHandler 的通用遍历模式（详见 `spec/events.md §6`）。核心不 hardcode 任何事件类型的特殊逻辑——全靠各事件 handler 的 `convertToLlm` 声明行为。

```typescript
function buildContext(tree: SessionTree, leafId: EventId): ScorelMessage[] {
  const path = tree.getPath(leafId);  // root → leaf
  const messages: ScorelMessage[] = [];

  // 从 leaf 往 root 走（reverse）
  for (let i = path.length - 1; i >= 0; i--) {
    const event = tree.get(path[i])!.event;
    const handler = getHandler(event.type);
    const result = handler.convertToLlm(event, ctx);

    switch (result.action) {
      case "include":
        messages.unshift(result.message);
        break;
      case "merge_prev":
        // 合入 messages 中最后一条 tool_result 的 content 末尾（<system-reminder> 包裹）
        mergeIntoPrevToolResult(messages, result.content);
        break;
      case "skip":
        break;
      case "barrier":
        // compact: 注入 summary，停止向上遍历
        messages.unshift(result.summary);
        return messages;
    }
  }

  return messages;
}
```

各事件类型的 LlmAction：
- `message`（普通）→ `include`
- `message`（meta.source = "steer"/"followUp"）→ `merge_prev`（前面有 tool_result 时）或 `include`（没有时）
- `compact` → `barrier`（注入 summary，停止遍历）
- `rewind` / `branch` / `channel_inject` / `session_info` / `custom` → `skip`
- `custom_message` → `include`
```

---

## 4. Rewind：append marker，不删历史

```typescript
async function rewindTo(targetEventId: EventId, expectedLeafId: EventId) {
  // 1. 乐观锁检查
  if (sessionLane.activeLeafId !== expectedLeafId) {
    throw new ConflictError("leaf_changed");
  }

  // 2. append rewind event —— 历史永不丢失
  const rewindEvent = await sessionLane.append({
    type: "rewind",
    targetEventId,
  });

  // 3. 更新 active leaf
  sessionLane.setActiveLeaf(targetEventId);

  // 4. 文件系统回滚不属于 session replay；用户仍通过 Git / 编辑工具处理工作区状态。
}
```

**约束**：rewind 目标必须是"turn 边界"——user 消息之后，或一组 toolResult 完成之后。UI 只暴露这些点，避免 rewind 到"assistant 已发消息但工具还没跑"的脏状态。

**Rewind 不跨 Compact**：Compact event 是硬边界。`rewind(targetId)` 时检查 path：target 在最近 compact 之后 → 允许；target 在 compact 之前 → 拒绝（返回 error: "cannot_rewind_past_compact"）。Compact 之前的事件保留在 JSONL 中供审计查阅，但不可回退到、UI 不展示。

---

## 5. Fork：clone 后独立

```typescript
async function cloneSession(
  fromEventId: EventId,
  meta?: Partial<SessionMeta>
): Promise<SessionId> {
  const newId = generateSessionId();
  const path = tree.getPath(fromEventId);  // root → target
  const events = path.map(id => tree.get(id)!.event);

  // 创建新 session，复制 events 到 fromEventId 为止
  await sessionStore.createWithEvents(newId, {
    ...currentHeader,
    sessionId: newId,
    clonedFrom: { sessionId: currentSessionId, deviceId, eventId: fromEventId },
    meta: { ...currentMeta, ...meta },
  }, events);

  return newId;
}
```

Clone 不引入任何新机制，只是在已有 JSONL 上切一刀、复制一份。Clone 后完全独立。

---

## 6. 压缩：`transformContext` 管线

压缩全部实现为 `transformContext` hook，每轮推理前执行。初期两层：

**Layer 1 · micro compact**
- 每轮都跑
- 把 >3 轮前的 `ToolResultMessage.content` 替换为占位符 `"[tool result omitted]"`
- 工具历史对 LLM 的下一步决策价值很低，但 UI 层仍能从原始 JSONL 还原展示

**Layer 2 · auto compact**
- 当 token 超过阈值（默认 `contextWindow * 0.7`）触发
- 前 70% 消息交给一次独立 LLM 调用生成摘要，后 30% 保留原样
- 摘要作为 CompactEvent 写入 JSONL
- **原始消息仍在 JSONL 里**；下次 buildContext 依据 CompactEvent 决定注入摘要并停止向上

```typescript
const compactionPipeline: TransformContextHook = async (messages, signal) => {
  messages = replaceOldToolResults(messages, { olderThan: 3 });    // Layer 1

  const tokens = estimateTokens(messages);
  if (tokens > agent.state.model.contextWindow * 0.7) {            // Layer 2
    const { summary, keepFrom } = await summarize(
      messages.slice(0, Math.floor(messages.length * 0.7)),
      agent.state.model,
      signal,
    );
    await sessionLane.append({
      type: 'compact',
      summary,
      compactedThrough: messages[keepFrom - 1].id,
      tokensBefore: tokens,
      tokensAfter: estimateTokens([createSummaryMessage(summary), ...messages.slice(keepFrom)]),
    });
    messages = [createSummaryMessage(summary), ...messages.slice(keepFrom)];
  }

  return messages;
};
```

**用户手动触发**（如 `/compact` 斜杠命令）直接跑一次 Layer 2，不需要另一条独立逻辑。

### 6.1 Auto Compact 安全约束

**自动 compact 绝不压缩当前 turn**。当前 turn（user message + assistant + 所有 tool_result）必须完整保留，否则 LLM 看不到自己的 tool_use/tool_result pair。

```typescript
// transformContext 中 auto compact 的安全边界
const currentTurnStart = findCurrentTurnStartIndex(messages);
const compactCandidates = messages.slice(0, currentTurnStart);  // 只压缩旧的
const preservedTail = messages.slice(currentTurnStart);          // 当前 turn 完整保留

if (estimateTokens(compactCandidates) > threshold) {
  const summary = await summarize(compactCandidates);
  // persist CompactEvent
  return [summaryMessage, ...preservedTail];
}
```

手动 compact 同理：只能 compact 到当前 activeLeaf 的最近一条 user message 之前。

### 6.2 树模型中的 Compact
- CompactEvent 只影响**它的后代**的 context 构建
- 在 compact 点之前分叉的其他分支不受影响
- 旧事件仍在 JSONL 中，可供历史浏览

---

## 7. 两层消息在本模块的落点

`convertToLlm` 边界现在由 EventTypeHandler 的 `convertToLlm` 方法实现（详见 `spec/events.md §6`）。对 Session 模块来说：

- 各事件类型通过 handler 声明自己的 LlmAction（include / merge_prev / skip / barrier）
- buildContext 通用遍历时调用每个 event 的 handler，不 hardcode 任何类型
- `rewind` / `branch` / `channel_inject` / `session_info` / `custom` → `skip`（不进入 LLM）
- `compact` → `barrier`（注入 summary，停止向上）
- `message`（meta.source = "steer"）→ `merge_prev`（合入前一条 tool_result 的 `<system-reminder>`）

换言之，应用层能玩的花样很多，LLM 始终只看到 handler 声明要暴露的内容。

---

## 8. 初期范围与延后项

**近期落地**
- v1 JSONL 格式 + SessionHeader
- SessionTree + buildContext

**延后**
- Rewind（乐观锁 + 不跨 compact）
- 压缩 Layer 1 + Layer 2
- Fork / Clone（跨 session 复制）
- 后续 schema migration（等真实 v2 出现再设计）
- 压缩摘要的 prompt 调优与策略自适应
- 跨 session 的资产检索（依赖后期 Memory 模块）

---

*本文档描述 Scorel 资产化存储的全部设计：单日志、树状结构、纯函数 buildContext、应用层与 LLM 层分离。*
