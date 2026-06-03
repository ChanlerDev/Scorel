# S0053 — Skill Index And Skill Tool

## Goal

按 Agent Skills 目录规范为 Scorel 增加 Skill baseline：

- 扫描 `~/.scorel/skills` 和 project `.scorel/skills`
- 建立 session-scoped Skill index，作为 Skill tool 的路由表
- 用 JSONL control events 持久化 skill index snapshot/delta
- 通过 `harness_item` 注入 skill listing / skill delta
- 暴露 `Skill(name)` 工具，按 index 加载完整 `SKILL.md`

本 spec 不做 Skill discovery ranking、不做 embedding/LLM 搜索、不做 marketplace。

## Why Now

S0051/S0052 建立了 harness item 与 queue control event。Skill 需要同样的原则：

- natural-language listing 只是给模型看的提醒，不是事实来源
- 工具调用必须查结构化 routing table
- session resume 后必须从 JSONL 恢复当时的 skill index

否则 `Skill("name")` 会依赖磁盘即时状态和 prompt 文本，无法审计和恢复。

## Scope

### 1. Directory Layout

V1 支持：

```text
~/.scorel/skills/<skill-name>/SKILL.md
<project-scope>/.scorel/skills/<skill-name>/SKILL.md
```

Project-scope discovery：

- 从 session `cwd` 往上查找 `.scorel/skills`
- 如果在 Git repository 内，在最近 Git root 停止
- 如果不在 Git repository 内，在 home 前停止
- `~/.scorel/skills` 作为 user global 独立加载

V1 只支持目录格式，不支持单个 `.md` 文件作为 skill。

### 2. Name And Routing

调用名以目录名为准：

```text
~/.scorel/skills/commit/SKILL.md -> Skill("commit")
```

frontmatter `name` 只作为 display name，不改变 tool routing key。

理由：

- Skill tool 调用必须有稳定、可预测的 key。
- 不规范 skill 不能通过正文或 display name 改变路由。
- listing/reminder 给模型看的 name 必须是可调用 name。

### 3. Skill Index

```typescript
interface SkillIndexEntry {
  name: string;
  path: string;
  scope: "user" | "project";
  description: string;
  displayName?: string;
  mtimeMs: number;
  size: number;
  contentHash: string;
  priority: number;
  shadowed?: boolean;
  diagnostics?: string[];
}

interface SkillIndexSnapshotEvent extends PersistentEventBase {
  type: "skill_index_snapshot";
  anchorEventId: EventId | null;
  entries: SkillIndexEntry[];
}

interface SkillIndexDeltaEvent extends PersistentEventBase {
  type: "skill_index_delta";
  anchorEventId: EventId | null;
  added: SkillIndexEntry[];
  changed: SkillIndexEntry[];
  removed: { name: string; previousPath: string }[];
}
```

Replay：

```text
skill_index_snapshot -> state.skillIndex = entries by name
skill_index_delta    -> patch state.skillIndex
```

The session state map is the source of truth for `Skill(name)`.

### 4. Scan And Diff

Before each real user message:

1. stat known skill paths and candidate skill directories
2. only read/parse changed files
3. build current index
4. compare with replayed session index
5. append `skill_index_snapshot` if no index exists
6. append `skill_index_delta` if added/changed/removed exists
7. append corresponding `harness_item` listing/delta for the model

No diff means no event.

### 5. Listing And Delta Injection

Initial listing:

```text
The following skills are available for use with the Skill tool:

- commit: Create a concise semantic commit...
- verify: Run the project's verification flow...
```

Delta:

```text
Skill updates detected:

Added:
- deploy: ...

Changed:
- verify: ...

Removed:
- old-skill
```

Both use `harness_item` and `<system-reminder>` conversion from S0051.

### 6. Skill Tool

Expose a builtin tool:

```typescript
Skill({ name: string, args?: string })
```

Execution:

- lookup `state.skillIndex[name]`
- if missing, return structured error listing known names
- read `entry.path`
- return the full `SKILL.md` content as a tool result or harness item payload for the next LM step
- record invoked skill metadata for display/diagnostics

V1 does not execute arbitrary scripts from skill directories. It only loads instructions and allows the model to inspect referenced files through normal tools.

### 7. Conflict Rules

Priority:

1. nearest project `.scorel/skills`
2. higher project `.scorel/skills`
3. user `~/.scorel/skills`

Same `name`:

- highest priority wins
- losing entries are shadowed
- diagnostics records shadowed paths
- listing only includes winning entries

Invalid skill:

- missing `SKILL.md`: ignored
- missing description: derive from frontmatter or first paragraph
- still no description: do not list; keep diagnostics
- unreadable file: do not list; keep diagnostics

## Explicitly Not In Scope

- Automatic skill search/ranking.
- Embedding search or small-model skill search.
- Plugin/marketplace skills.
- MCP skills.
- Running skill scripts automatically.
- User-facing `/skills` management UI.
- Conditional `paths` activation beyond parsing and preserving metadata.

## Required Tests

### Discovery

- user skills are loaded from `~/.scorel/skills`.
- project skills are loaded from cwd upward to Git root or home boundary.
- directory name is the tool routing key.
- frontmatter display name does not change routing key.
- same-name project skill shadows user skill.

### Index Events

- first scan writes `skill_index_snapshot`.
- added/changed/removed skill writes `skill_index_delta`.
- replay from JSONL reconstructs skill index.
- no diff writes no event.

### Harness Injection

- initial snapshot emits `harness_item kind=skill_listing`.
- delta emits `harness_item kind=skill_delta`.
- listing/delta do not become routing source; state.skillIndex remains source of truth.

### Skill Tool

- `Skill("name")` loads content from indexed path.
- missing skill returns structured error.
- changed skill content is loaded after delta replay updates index.

## Likely Files

```text
packages/protocol/src/events.ts
packages/core/src/session/index.ts
packages/core/src/session/session.test.ts
packages/core/src/tools/*
packages/daemon/src/index.ts
packages/daemon/src/index.test.ts
packages/daemon/src/skills/*
docs/spec/events.md
docs/spec/runtime.md
docs/spec/extensions.md
```

## Risks And Boundaries

- Do not parse harness reminder text to rebuild skill state.
- Do not trust frontmatter `name` as routing key.
- Do not rescan full file contents every turn when stat/hash can avoid it.
- Do not make Skill discovery ranking part of V1; available listing plus explicit Skill tool is enough.

## Done When

- Scorel maintains a session-scoped skill index from JSONL snapshot/delta events.
- Skill listing/delta are injected through harness items.
- `Skill(name)` routes through the index and loads `SKILL.md`.
- Resume reconstructs the same skill index before tool invocation.
- Automatic tests and typecheck pass.
- 完成后 commit：`S0053: feat: add skill index and skill tool`
