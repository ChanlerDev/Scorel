# S0050 — Instruction Snapshot And AGENTS.md Assembly

## Goal

把 Scorel 当前 `systemPrompt = undefined` 的 runtime 路径升级为正式的 harness input assembly：

- session 初始化时发现并装配 `AGENTS.md`
- 生成一份冻结的 `instruction_snapshot`
- 将其作为一等 PersistentEvent 写入 session JSONL
- 后续 turn 从 snapshot 派生 provider-level `systemPrompt`
- 当前 session 内 system prompt 不因磁盘文件变动而漂移

本 spec 只定义 **instruction snapshot 与 runtime 接线**。不在本轮引入 GUI、HTTP API、自动刷新 snapshot 或 `<system-reminder>` 扩展语义。

## Why Now

当前 `M7` 已被定义为 Agent Runtime Quality。现状存在一个明确缺口：

- `packages/core/src/runtime/index.ts` 已支持 `executeTurn(context, systemPrompt, options)`
- `packages/core/src/provider/pi-ai.ts` 已支持把 `systemPrompt` 作为独立 provider 字段传给 pi-ai
- 但 `packages/daemon/src/index.ts` 仍以 `undefined` 调用 runtime

结果是：

- `AGENTS.md` 尚未进入真实产品主链路
- session 恢复、clone、branch、审计都无法回答“这个会话当时到底吃了哪份 instruction set”
- 未来 memory / workspace summary / runtime guidance 没有稳定挂点

在继续做 `<system-reminder>`、diagnostics、eval 之前，必须先把 session-scoped instruction snapshot 模型锁定。

## Scope

### 1. AGENTS.md Discovery

V1 discovery 规则固定如下：

- 发现基准是 session 初始化时的当前 `cwd`
- 从 `cwd` 逐级向上查找 project-scope `AGENTS.md`
- 如果 `cwd` 在 Git repository 内，project walk 在最近的 Git root 停止
- 如果 `cwd` 不在 Git repository 内，project walk 在用户 home `~` 前停止；不把 home 自身作为 project scope 读取
- 额外读取 `~/.scorel/AGENTS.md` 作为用户级全局源
- 所有命中的 `AGENTS.md` **全部加载**，不是只取最近一个
- discovery 结果在 session 初始化时冻结；当前 session 后续不动态重算

优先级模型：

- 高层目录先发现，低层目录后发现
- 更接近当前 `cwd` 的文件优先级更高
- 用户级全局源独立于 project walk；它不是 project-scope parent
- 当前 V1 只支持 `AGENTS.md`
- 不支持：
  - `AGENTS.override.md`
  - `SCOREL.md`
  - `scrolls.md`
  - fallback filenames
  - include/import 展开

### 2. First-Class `instruction_snapshot` PersistentEvent

协议新增一等 PersistentEvent：

```typescript
interface InstructionSnapshotEvent extends PersistentEventBase {
  type: "instruction_snapshot";
  snapshot: InstructionSnapshot;
}
```

它的语义是：

- 记录一个 session 初始化时冻结下来的 instruction assembly 结果
- 用于 resume、clone、branch、audit、diagnostics 和 runtime system prompt 派生
- 不直接作为普通 message 进入 LLM context

V1 规则：

- 一个 session 默认只追加一条 `instruction_snapshot`
- 追加时机是：
  - 首次 user message 持久化前或紧邻其前
  - 保证该 snapshot 在 JSONL 中先于首个 user turn 出现
- 不支持 session 中途自动刷新 snapshot

### 3. Structured Snapshot Schema

`instruction_snapshot` 不存一段无结构大字符串，而存结构化 section。

V1 section 顺序固定为：

1. `baseline`
2. `agents`
3. `memory`
4. `workspace`
5. `environment`
6. `time`

建议协议形态：

```typescript
type InstructionSectionKind =
  | "baseline"
  | "agents"
  | "memory"
  | "workspace"
  | "environment"
  | "time";

interface InstructionSource {
  sourceType: "builtin" | "agents_md" | "memory";
  path?: string;
  scope?: "global_user" | "project";
  priority?: number;
  content?: string;
}

interface InstructionSection {
  kind: InstructionSectionKind;
  frozenAt: number;
  sources?: InstructionSource[];
  renderedBlock: string;
  data?: Record<string, unknown>;
}

interface InstructionSnapshot {
  version: 1;
  cwd: string;
  sections: InstructionSection[];
}
```

V1 约束：

- 所有 section 以固定顺序写入 snapshot
- 每个 section 至少保留 `kind`、`frozenAt`、`renderedBlock`
- `agents` section 必须保留来源块：
  - `path`
  - `scope`
  - `priority`
  - `content`
- `memory`、`workspace`、`environment`、`time` 即使当下内容很轻，也必须进入结构化 schema，而不是以后再另起另一套快照模型

### 4. Section Meaning

#### `baseline`

Scorel 自带的静态系统提示词，不来自用户文件。

包括但不限于：

- agent/product identity
- 输出与安全高层原则
- 工具使用的高层纪律
- `<system-reminder>` 解释性声明

这里冻结的是 **baseline prompt block**，不是未来所有实现细节的不可变版本数据库。

#### `agents`

`AGENTS.md` discovery 与装配结果。

要求：

- 以带来源分块的形式保存
- `renderedBlock` 是最终进入 provider-level system prompt 的 AGENTS block
- 当前 V1 不做 include/import 扩展

#### `memory`

进入 system prompt 的 memory block。

V1 可以先接入最小来源，甚至为空 block，但 schema 必须预留该 section。后续 memory specs 只能扩展其来源，不应再改变 snapshot 总模型。

#### `workspace`

工作区结构摘要，而不是全量目录树。

V1 建议只包含：

- `cwd`
- repo root / workspace root（如可得）
- monorepo/workspace 摘要
- 关键顶层模块/目录摘要

不要把 `find .` 或大体量树结构塞进该 section。

#### `environment`

运行环境摘要，例如：

- platform
- shell
- OS version
- git/worktree 约束
- 其他需要稳定告知 agent 的运行环境信息

#### `time`

时间快照，例如：

- session start timestamp
- local timezone
- human-readable date string

V1 明确接受它在长会话中会 stale，因为当前产品选择就是 session 初始化后冻结 prompt。

### 5. Runtime Integration

`instruction_snapshot` 的正确用途不是进入 `buildContext()` 普通消息流，而是：

1. session 初始化时生成并 append 到 JSONL
2. daemon/lane 在内存中持有这份 snapshot
3. 每次 `runtime.executeTurn()` 前，把 snapshot sections 渲染为 provider-level `systemPrompt`
4. 通过已有独立参数传给 runtime/provider

也就是：

```text
instruction_snapshot -> renderSystemPrompt(snapshot) -> executeTurn(context, systemPrompt, ...)
```

不允许：

- 把最终 provider-level system prompt 当普通 `message` / `custom_message` 塞进 `buildContext()`
- 依赖 `role = "system"` message 让 pi-ai 推导 system prompt

原因是当前 `packages/core/src/provider/pi-ai.ts` 会把 `role === "system"` 的 ScorelMessage 降成 provider `user` message，而不是 provider-level `systemPrompt`。

### 6. Session / Resume / Clone / Branch Semantics

V1 规则：

- loadSession 时必须能读出 `instruction_snapshot`
- 恢复当前 session 时继续使用这条 snapshot
- clone 成新 session 时：
  - 默认复制源 session 的 snapshot 作为新 session 的初始 snapshot
  - 不重新从磁盘发现 `AGENTS.md`
- 同一 session 内 branch 到旧 event 时：
  - 继续使用本 session 既有 snapshot
  - 不追加新的 `instruction_snapshot`
  - branch 只改变 conversation tree 的 leaf，不改变 harness input world

理由：

- clone 是复制已有 session 状态到新 session，不是按当前磁盘环境重新初始化 prompt world
- branch 是同一 session 内的 conversation-tree 分叉，更不应该重新发现磁盘指令

## Explicitly Not In Scope

- `<system-reminder>` 新注入来源与 merge 语义扩展
- memory 检索/召回策略本身
- GUI 或 WebUI 对 snapshot 的可视化
- 自动刷新 snapshot、cache invalidation 后追加新 snapshot
- `AGENTS.override.md`
- `SCOREL.md` / `scrolls.md`
- fallback filenames
- include/import 语法
- 基于目标文件路径的动态重算
- 让 `instruction_snapshot` 进入普通 LLM context message history
- 重写当前完整 EventTypeHandler/convertToLlm 架构；本 spec 只要求新事件具备明确 skip/display 行为

## Required Tests

### Protocol

- 新增 `instruction_snapshot` 到 PersistentEvent union。
- `instruction_snapshot` round-trip 持久化与解析通过。

### Session Core

- session JSONL 可在 header 后追加 `instruction_snapshot` 再追加普通消息。
- `buildContext()` 不把 `instruction_snapshot` 当普通 message 带进消息历史。
- loadSession / append 对该事件类型通过校验。

### AGENTS.md Discovery

- project walk 从 `cwd` 到最近 Git root；无 Git root 时到 home 前停止。
- `~/.scorel/AGENTS.md` 作为用户级全局源进入 snapshot。
- 近处文件优先级高于远处文件。
- 当前 session 初始化后，即使磁盘上 `AGENTS.md` 改变，后续 turn 仍使用原 snapshot。

### Snapshot Shape

- snapshot 含固定 section 顺序：
  - baseline
  - agents
  - memory
  - workspace
  - environment
  - time
- `agents` section 保留带来源的 source blocks。
- `workspace` section 是摘要而不是全量树。

### Runtime Integration

- 首个 turn 之前若无 snapshot，daemon 会先生成并 append snapshot，再调用 runtime。
- 后续 turn 复用同一 snapshot 渲染的 system prompt。
- `packages/daemon/src/index.ts` 不再以 `undefined` 调用 runtime。
- pi-ai request payload 能看到 provider-level `systemPrompt`。

### Resume / Clone / Branch

- reload 现有 session 后仍能读取并使用相同 snapshot。
- clone 后新 session 继承源 session snapshot，而不是重新做磁盘 discovery。
- branch 到同一 session 的旧 event 时不生成新 snapshot。

## Likely Files

```text
packages/protocol/src/events.ts
packages/protocol/src/index.test.ts
packages/core/src/session/index.ts
packages/core/src/session/session.test.ts
packages/core/src/runtime/index.ts
packages/core/src/provider/pi-ai.ts
packages/core/src/provider/pi-ai.test.ts
packages/daemon/src/index.ts
packages/daemon/src/index.test.ts
packages/daemon/src/projects/sessions.ts
docs/spec/session.md
docs/spec/events.md
docs/spec/runtime.md
```

## Risks And Boundaries

- 如果把完整最终 provider prompt 冻结到 JSONL，会把 baseline wording、tool contract wording 和 runtime baseline 一起版本化，兼容边界过重；V1 只冻结结构化 snapshot 与其 rendered blocks。
- `time` section 会 stale，这是产品明确接受的冻结代价，不算 bug。
- `memory` section 当前即使实现很轻，也必须占住结构化位置，避免后续再改 snapshot 总模型。
- 现有 `buildContext()` 仍是 M1 风格“只收 message”的实现；本 spec 不强迫一次性重构为完整 EventTypeHandler 架构，但要求 `instruction_snapshot` 能在现有边界下被稳定跳过。

## Done When

- session 首次进入主链路时会 append 一条 `instruction_snapshot`
- snapshot 使用固定 section schema，包含 `baseline / agents / memory / workspace / environment / time`
- `AGENTS.md` project discovery 从 `cwd` 到最近 Git root 或 home 前停止，并包含 `~/.scorel/AGENTS.md`
- 当前 session 内 system prompt 由 snapshot 派生且保持冻结
- runtime 不再以 `undefined` 调用 provider-level `systemPrompt`
- 自动测试与 typecheck 通过
- 完成后 commit：`S0050: feat: add instruction snapshot and agents assembly`
