# d001 — 会话资产：Event Sourcing + Replay

> 上游：`d000-architecture.md`
> 主题：把对话、工具调用、文件修改全部收敛到一条 append-only JSONL 上，所有"时间旅行"都是同一个 `replay` 函数的不同输入。

---

## 1. 设计目标

Scorel 不把会话当做"可丢的上下文"，而当做**资产**。资产的核心要求有三条：

1. **不丢失**：JSONL 只追加、不修改，任何历史都可被重建
2. **可重放**：Rewind、Fork、File Checkpoint 都通过同一个 `replay()` 函数从 JSONL 推导出目标状态
3. **可隔离**：会话中的"自定义记录"（rewind 标记、文件快照引用、channel 元数据）只存在于应用层，LLM 永远看不到（由 `convertToLlm` 在边界上过滤）

这三条要求共同决定了架构形状：**单一日志 + 纯函数 replay + 两层消息**。

---

## 2. 存储格式

每个 session 一个目录，主体是一条 `log.jsonl`：

```
~/.scorel/sessions/
  abc123/
    log.jsonl           ← 主日志（append-only）
    snapshots/
      file-{hash}.blob  ← 文件快照内容（按哈希去重）
    meta.json           ← session 元信息（cwd / model / created_at）
```

每行是一条 `LogEntry`：

```typescript
type LogEntry =
  | { kind: 'message'; message: AgentMessage }                           // 普通消息
  | { kind: 'rewind'; targetId: string; at: number }                     // rewind 标记
  | { kind: 'file_snapshot'; path: string; hash: string; at: number }    // 文件快照引用
  | { kind: 'compact'; summary: string; beforeId: string; at: number }   // 压缩标记
  | { kind: 'channel'; channel: string; externalId: string; at: number } // channel 元数据
```

所有非 `message` 类型只用于**应用层**：replay 期间被消费，`convertToLlm` 阶段被过滤，LLM 不会看到它们。

---

## 3. 写入：`agent.subscribe` 同步落盘

```typescript
agent.subscribe(async (event) => {
  if (event.type === 'message_end') {
    await session.append({ kind: 'message', message: event.message });
  }
});
```

pi-agent-core 会 `await` listener，写入失败会阻塞 `waitForIdle()`——**背压安全**，不会出现 "UI 已渲染但磁盘还没写入" 的不一致。

`ToolResultMessage` 随 `message_end` 一并落盘，不需要额外订阅 `tool_execution_end`。

---

## 4. 加载：replay 函数

```typescript
function replay(entries: LogEntry[]): {
  messages: AgentMessage[];
  filesToRestore: Map<string, string>;  // path → snapshot hash
} {
  const messages: AgentMessage[] = [];
  const filesToRestore = new Map<string, string>();
  let skipUntil: string | null = null;

  // 从下往上扫描
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];

    if (entry.kind === 'rewind') {
      skipUntil = entry.targetId;   // 之前、target 之后的所有 entry 失效
      continue;
    }

    if (skipUntil) {
      if (entry.kind === 'message' && entry.message.id === skipUntil) {
        skipUntil = null;            // 到达 rewind 目标，本条保留
      } else {
        continue;
      }
    }

    if (entry.kind === 'message') {
      messages.unshift(entry.message);
    } else if (entry.kind === 'file_snapshot') {
      if (!filesToRestore.has(entry.path)) {
        filesToRestore.set(entry.path, entry.hash);  // 以最老的快照为准
      }
    }
  }

  return { messages, filesToRestore };
}
```

Session 恢复流程：读完整 JSONL → `replay()` → 还原 `agent.state.messages`。文件内容只在用户显式 rewind 时从 `snapshots/` 恢复。

> **架构洞察**：Event Sourcing 让 Rewind、Fork、审计/调试收敛成同一个 replay 函数的不同输入。这是分布式系统里 WAL / Kafka compaction 用的同一套思想。

---

## 5. Rewind：append marker，不删历史

```typescript
async function rewindTo(messageId: string) {
  // 1. append rewind marker —— 历史永不丢失
  await session.append({ kind: 'rewind', targetId: messageId, at: Date.now() });

  // 2. 重新 replay
  const entries = await session.readAll();
  const { messages, filesToRestore } = replay(entries);

  // 3. 恢复文件
  for (const [path, hash] of filesToRestore) {
    await fs.writeFile(path, await session.readSnapshot(hash));
  }

  // 4. 更新内存状态
  agent.state.messages = messages;
}
```

**约束**：rewind 目标必须是"turn 边界"——user 消息之后，或一组 toolResult 完成之后。UI 只暴露这些点，避免 rewind 到"assistant 已发消息但工具还没跑"的脏状态。pi-ai 的 `transformMessages` 会自动补 orphan tool result 作为保底，但那不是期望路径。

---

## 6. Fork：复制前缀 + 新 id

```typescript
async function fork(sessionId: string, fromMessageId: string): Promise<string> {
  const newId = generateId();
  const entries = await session.readAll(sessionId);
  const upToPoint = entries.slice(0, findIndexOf(entries, fromMessageId) + 1);
  await session.createWithEntries(newId, upToPoint);
  return newId;
}
```

Fork 不引入任何新机制，只是在已有 JSONL 上切一刀、复制一份。

---

## 7. File Checkpoint：写类工具的前置快照

任何写类工具（`write` / `edit` / 自定义）执行**前**，自动对目标文件做快照。快照记录和消息**共用同一条 JSONL**，rewind 时一并恢复。

```typescript
// 在 beforeToolCall hook 里做（d004 的 hook 机制）
beforeToolCall: async (ctx) => {
  if (!isWriteTool(ctx.toolName)) return;

  const path = extractPath(ctx.toolName, ctx.args);
  if (!(await fs.exists(path))) return;

  const content = await fs.readFile(path);
  const hash = sha256(content);
  await session.writeSnapshot(hash, content);  // content-addressable 去重
  await session.append({ kind: 'file_snapshot', path, hash, at: Date.now() });
}
```

**去重机制**：hash 作为文件名，同一内容只存一份。Coding Agent 场景下"多次读同一个文件"非常友好。

**为什么不用 Git**：
- Git 会误伤用户未提交的改动
- Git 操作粒度是仓库级，不是 session 级
- 跨仓库 / 非 Git 目录（如 `/tmp`）Git 不管用

---

## 8. 压缩：`transformContext` 管线

压缩全部实现为 `transformContext` hook，每轮推理前执行。初期两层：

**Layer 1 · micro compact**
- 每轮都跑
- 把 >3 轮前的 `ToolResultMessage.content` 替换为占位符 `"[tool result omitted]"`
- 工具历史对 LLM 的下一步决策价值很低，但 UI 层仍能从原始 JSONL 还原展示

**Layer 2 · auto compact**
- 当 token 超过阈值（默认 `contextWindow * 0.7`）触发
- 前 70% 消息交给一次独立 LLM 调用生成摘要，后 30% 保留原样
- 摘要作为特殊 user message 注入，并在 JSONL 里 append 一条 `compact` 标记
- **原始消息仍在 JSONL 里**；下次 replay 依据 `compact` 标记决定用摘要还是原文

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
    await session.append({
      kind: 'compact',
      summary,
      beforeId: messages[keepFrom].id,
      at: Date.now(),
    });
    messages = [createSummaryMessage(summary), ...messages.slice(keepFrom)];
  }

  return messages;
};
```

**用户手动触发**（如 `/compact` 斜杠命令）直接跑一次 Layer 2，不需要另一条独立逻辑。

---

## 9. 两层消息在本模块的落点

`convertToLlm(AgentMessage[]) → Message[]` 是"应用层 → LLM 层"的唯一边界。对 Session 模块来说：

- `rewind` / `file_snapshot` / `compact` / `channel` 这类 LogEntry **根本不是 message**，它们在 replay 阶段就被消化掉，不会进入 `transformContext` 的输入
- `convertToLlm` 在这层做兜底过滤（例如带 `meta.scorelInternal` 标记的 message）

换言之，应用层能玩的花样很多，LLM 始终只看到干净的对话序列。

---

## 10. 初期范围与延后项

**初期落地**
- `log.jsonl` + `snapshots/` 目录结构
- `replay()` 函数、Rewind、Fork
- File Checkpoint（基于 `beforeToolCall` hook）
- 压缩 Layer 1 + Layer 2

**延后**
- Snapshot 归档（旧 snapshot 移到 `.archive/` 防止膨胀）
- 压缩摘要的 prompt 调优与策略自适应
- 跨 session 的资产检索（依赖后期 Memory 模块）

---

*本文档描述 Scorel 资产化存储的全部设计：单日志、纯函数 replay、应用层与 LLM 层分离。其他模块请参见对应 `dXXX` 文档。*
