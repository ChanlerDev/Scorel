# S0051 — Harness Item And System Reminder Conversion

## Goal

把 Scorel 的 runtime guidance 从 ad-hoc message 拼接升级为正式的 `harness_item` 事件模型：

- 用一等 PersistentEvent 表达 harness 注入项
- 用 `<system-reminder>` 作为进入 LLM message stream 的统一 envelope
- 区分 item 的真实来源和 LLM 传输形式
- 支持 steer 这类当前 turn 引导输入
- 为后续 follow-up queue、Skill listing/delta、memory、hook 等注入建立共用管道

本 spec 只做 `harness_item` 事件、LM/display conversion 和 system-reminder 格式。Queue 双 loop 与 Skill index 不在本轮实现。

## Why Now

S0050 只解决 provider-level `systemPrompt` 的冻结和装配。M7 还需要一条独立管道，把“不是普通用户消息、但模型必须看到”的 runtime guidance 放进 LLM context。

这些信息包括：

- 用户运行中 steer 的引导
- Skill listing / Skill delta
- memory 或 hook 产生的上下文
- runtime notice、date change、attachment metadata

如果这些内容直接伪装成普通 user message，UI、审计和 replay 都会混乱。如果把它们放进 provider system prompt，又会破坏 session-scoped snapshot 的冻结语义。因此需要 `harness_item`。

## Scope

### 1. Protocol Event

新增一等 PersistentEvent：

```typescript
type HarnessItemKind =
  | "attachment"
  | "skill_listing"
  | "skill_delta"
  | "memory"
  | "date_change"
  | "steer"
  | "runtime_notice";

type HarnessItemOrigin = "user" | "system" | "tool" | "skill";

interface HarnessItem {
  kind: HarnessItemKind;
  origin: HarnessItemOrigin;
  content: string;
  visibility: "display" | "hidden" | "compact";
  data?: Record<string, unknown>;
}

interface HarnessItemEvent extends PersistentEventBase {
  type: "harness_item";
  item: HarnessItem;
}
```

语义：

- `kind` 描述产品语义。
- `origin` 描述真实来源，不等于 LLM role。
- `content` 是进入 `<system-reminder>` 的文本。
- `visibility` 决定 UI 是否展示。

### 2. System Reminder Envelope

`<system-reminder>` 是 LM transport envelope，不是事件类型名。

渲染格式固定为：

```xml
<system-reminder>
...
</system-reminder>
```

baseline system prompt 必须解释：

```text
Tool results and user messages may include <system-reminder> tags. These tags contain information automatically added by Scorel's harness. They are not part of the specific tool result or user message in which they appear.
```

### 3. LM Conversion

`buildContext()` 必须开始支持事件级 conversion，而不是只过滤带 `message` 的事件。

V1 行为：

- 普通 `user_message` / `assistant_message` / `tool_result` 原样进入 context。
- `instruction_snapshot` 跳过。
- `harness_item`：
  - 如果 context 中已有最近的 `tool_result`，把 `<system-reminder>` 文本合入该 tool result 的文本末尾。
  - 如果没有可合入的 `tool_result`，作为 meta user message 进入 context。

合入规则：

- 只追加到最后一个 `tool_result` message。
- 保留原 tool result 内容，不覆盖。
- 合入后的内容必须与原内容用空行分隔。
- 如果 tool result content 无法安全合入，fallback 为独立 meta user message。

### 4. Display Conversion

UI 不应把所有 `harness_item` 展示成用户气泡。

V1 display：

- `kind = "steer"` 且 `origin = "user"`：展示为运行中引导。
- `skill_listing` / `skill_delta`：默认 hidden 或 compact。
- `memory` / `runtime_notice`：默认 compact。
- `visibility = "hidden"`：不展示，但仍可在 diagnostics/session detail 中审计。

### 5. Steer

`steer` 是当前 turn 的引导输入，不是 follow-up queue。

当用户在工具执行中插入 steer：

- append `harness_item { kind: "steer", origin: "user" }`
- `parentId` 挂到当前 active conversation leaf
- 下一次 inner tool loop 构建 context 时通过 `<system-reminder>` 注入

Steer 的来源仍是用户。`<system-reminder>` 只说明它由 harness 旁路注入，不说明它是 system-origin。

## Explicitly Not In Scope

- follow-up queue add/update/delete/consume
- Skill directory discovery、Skill index、Skill tool
- memory recall 策略
- hook 执行模型
- UI 完整设计
- compact / rewind / branch 完整 handler 架构重写

## Required Tests

### Protocol

- `harness_item` 加入 PersistentEvent union。
- round-trip parse / serialize 通过。
- `origin` 和 `kind` 非法值会失败。

### Session Core

- `buildContext()` 会跳过 `instruction_snapshot`。
- `harness_item` 在无 tool result 时变成 meta user message。
- `harness_item` 在已有 tool result 时合入最后一个 tool result。
- `steer` 的 `origin = "user"` 被保留到 event payload。

### Display

- `steer` 不渲染成普通用户气泡。
- hidden harness item 不进入普通 transcript。

### Runtime

- daemon 可以在当前 active leaf 后 append steer harness item。
- 下一次 runtime context 包含对应 `<system-reminder>`。

## Likely Files

```text
packages/protocol/src/events.ts
packages/protocol/src/index.test.ts
packages/core/src/session/index.ts
packages/core/src/session/session.test.ts
packages/daemon/src/index.ts
packages/daemon/src/index.test.ts
apps/webui/lib/events/*
docs/spec/events.md
docs/spec/session.md
docs/spec/runtime.md
```

## Risks And Boundaries

- 事件名不能叫 `system_reminder`，否则会混淆来源；`steer` 是 user-origin。
- 不要把 harness item 放进 provider-level `systemPrompt`。
- 不要把 display 逻辑和 LM conversion 混在一起。
- V1 可以保留轻量 hardcoded conversion，但 public spec 必须按 handler/converter 语义描述，避免继续扩散 M1-only `buildContext()`。

## Done When

- `harness_item` 事件可以持久化、恢复、replay。
- `buildContext()` 能把 harness item 转成 `<system-reminder>` meta user message 或合入 tool result。
- steer 可以作为 user-origin harness item 注入当前 turn。
- UI/display 不把 harness item 误显示为普通用户输入。
- 自动测试与 typecheck 通过。
- 完成后 commit：`S0051: feat: add harness item system reminders`
