# S0052 — Follow-Up Queue And Dual Loop Runtime

## Goal

实现 Scorel 的双 loop runtime 调度模型：

- outer loop 消费 follow-up queue，把排队输入变成下一条真实 `user_message`
- inner loop 执行当前 user turn，并消费 steer guidance
- 用 JSONL control events 持久化 queue state，避免 daemon 崩溃或 reconnect 后丢失 follow-up
- 保证 follow-up 消费时的 `parentId` 指向当前 final leaf，而不是排队时的中间 leaf

本 spec 建立 queue control event 和双 loop，不实现 Skill index。

## Why Now

运行中的用户输入有两种不同语义：

- `steer`：引导当前 turn，属于 inner loop guidance。
- `follow_up`：排队等待当前 turn 结束后执行，属于 outer loop input queue。

如果 follow-up 在收到时直接写成 `user_message`，它的 parent 会挂到当前中间 leaf，破坏 conversation graph。正确做法是先持久化 queue state，等当前 turn 结束后再消费成真正的 user message。

## Scope

### 1. Control Event

新增 queue control event：

```typescript
type QueueName = "follow_up" | "steer";

interface QueueItem {
  id: string;
  content: ScorelMessage["content"];
  createdAt: number;
  updatedAt: number;
  clientId: ClientId;
  data?: Record<string, unknown>;
}

interface QueueUpdateEvent extends PersistentEventBase {
  type: "queue_update";
  queue: QueueName;
  operation: "rewrite";
  items: QueueItem[];
  anchorEventId: EventId | null;
}
```

V1 只支持 full rewrite。Add、edit、delete 都通过写入完整 queue snapshot 表达。

理由：

- queue 很小，重复写完整状态成本低。
- replay 简单，最后一条 rewrite 就是当前 queue。
- UI 同步更直接。

### 2. Control Events Do Not Enter Conversation Tree

`queue_update` 是 control event：

- 写入 JSONL
- replay 时更新 queue state
- 不参与 `SessionTree.getPath()`
- 不进入 `buildContext()` message list

`parentId` 对 control event 不表达 conversation parent。V1 可以保留 `parentId: null` 或迁移为 control-only base，但 public 语义必须明确：conversation order 由 thread parent 表达，control state 由 JSONL seq replay 表达。

### 3. Outer Loop

daemon turn loop 必须变成：

```text
while true:
  if followUpQueue has item:
    consume first item
    append user_message(parent = current final leaf, meta.source = "follow_up")
    run inner loop
    continue

  wait for normal user send_message
  append user_message(parent = requested parent or active leaf)
  run inner loop
```

消费 follow-up 时：

- append `user_message`
- `message.meta.source = "follow_up"`
- `message.meta.queueItemId = queueItem.id`
- append `queue_update` rewrite，移除已消费 item

### 4. Inner Loop

inner loop 执行当前 user turn：

```text
while runtime needs continuation:
  build context
  execute model/tool step
  persist assistant/tool_result
  check steer queue
  if steer exists:
    consume steer
    append harness_item kind=steer origin=user
    continue
```

`steer` 可以也用 `queue_update` 管理，但消费后必须变成 `harness_item`，而不是 `user_message`。

### 5. IDs And Ordering

示例：

```text
e1 user_message parent=null
e2 assistant_message parent=e1
e3 tool_result parent=e2
q1 queue_update queue=follow_up items=[fu1] anchorEventId=e3
e4 assistant_message parent=e3
q2 queue_update queue=follow_up items=[] anchorEventId=e4
e5 user_message parent=e4 meta.source=follow_up meta.queueItemId=fu1
```

关键规则：

- JSONL `seq` 是物理 replay 顺序。
- `parentId` 是 conversation graph。
- follow-up 排队时的 `anchorEventId` 只用于审计/UI，不决定后续 user message parent。
- follow-up 消费后的 user message parent 必须是当前 final leaf。

## Explicitly Not In Scope

- 多优先级 queue。
- background task scheduler。
- WebUI 完整 queue 编辑 UI。
- branch/rewind 的完整 queue conflict UI。
- Skill discovery / Skill tool。

## Required Tests

### Protocol / Session

- `queue_update` round-trip 通过。
- replay queue rewrite 能恢复当前 queue state。
- `queue_update` 不进入 `buildContext()`。
- `queue_update` 不成为 conversation leaf。

### Follow-Up

- 当前 turn 中收到 follow-up 后，JSONL 写入 queue state，但不立即产生 user message。
- 当前 turn 结束后，follow-up 被消费成新的 `user_message`。
- 消费后的 `user_message.parentId` 指向当前 final leaf。
- edit/delete 通过 rewrite 生效。

### Steer

- steer queue item 在 inner loop 消费成 `harness_item kind=steer`。
- steer 不变成 follow-up user message。

### Runtime

- follow-up queue 连续多条时，outer loop 逐条消费。
- daemon restart 后可以从 JSONL 恢复未消费 follow-up queue。

## Likely Files

```text
packages/protocol/src/events.ts
packages/core/src/session/index.ts
packages/core/src/session/session.test.ts
packages/daemon/src/index.ts
packages/daemon/src/index.test.ts
packages/client/src/*
apps/webui/*
docs/spec/events.md
docs/spec/runtime.md
docs/spec/session.md
```

## Risks And Boundaries

- 不要把 follow-up 存成普通 user message 再等待消费；那会污染 parent graph。
- 不要把 queue state 放进 daemon-only memory；必须能从 JSONL replay。
- 不要用 JSONL 行顺序替代 conversation parent。
- 如果当前 session branch/leaf 切换，follow-up 消费必须以消费时 active leaf 为 parent。

## Done When

- follow-up add/edit/delete/rewrite 都以 `queue_update` control event 持久化。
- daemon outer loop 会在当前 turn 完成后消费 follow-up。
- steer 和 follow-up 分别走 inner guidance 与 outer queued input。
- `buildContext()` 不包含 queue control events。
- 自动测试与 typecheck 通过。
- 完成后 commit：`S0052: feat: add follow-up queue dual loop`
