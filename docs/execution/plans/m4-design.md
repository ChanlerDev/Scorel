# M4 Compact & Skills — 设计与技术文档

> 状态：待实现 | 基于 V0-M4 spec

## 1. 目标

在 M1–M3 完成 streaming、tool execution、history & search 的基础上，解决两个核心问题：

1. **长 session 上下文爆炸**：tool loop 密集场景下，数十轮 tool_result 会快速耗尽 context window
2. **可扩展能力注入**：模型需要按需加载领域知识（SKILL.md），而非把所有内容塞进 system prompt

解法：三层 compact（micro + manual + boundary resume）+ 两层 skill injection。

## 2. 现状盘点

### 已就绪（可直接使用）

| 组件 | 位置 | 说明 |
|------|------|------|
| `compactions` 表 | `db.ts` SCHEMA_V1 | id, session_id, boundary_message_id, summary_text, provider_id, model_id, transcript_path, created_at |
| `sessions.active_compact_id` | `db.ts` SCHEMA_V1 | 外键指向当前生效的 compaction record |
| `SessionDetail.activeCompactId` | `types.ts` | 已在类型中声明 `string \| null` |
| `SessionState = "compacting"` | `constants.ts` | 已在联合类型中预留 |
| `compact.manual` / `compact.failed` 事件 | `events.ts` | ScorelEvent 联合类型已定义 |
| `MICRO_COMPACT_KEEP_RECENT = 3` | `constants.ts` | micro_compact 保留最近 3 轮 |
| `MANUAL_COMPACT_MAX_INPUT = 100_000` | `constants.ts` | manual compact 序列化上限 |
| `MANUAL_COMPACT_TOOL_RESULT_PREVIEW = 500` | `constants.ts` | manual compact 中 tool_result 截断长度 |
| `ToolName` 含 `"load_skill"` | `types.ts` | 已在联合类型中预留 |
| `tool-dispatch.ts` 描述 | `getToolDescription()` | `"Load a skill file (reserved for M4)."` |

### 待实现

| 组件 | 说明 |
|------|------|
| `src/main/core/compact.ts` | micro_compact 算法 + manual compact 流程 |
| `src/main/storage/compactions.ts` | compaction 记录 CRUD |
| `src/main/skills/skill-loader.ts` | 扫描 + 解析 + 加载 SKILL.md |
| `skills/*.md` | 示例 SKILL.md 文件 |
| load_skill 工具注册 | tool-dispatch.ts 新增 ToolEntry |
| Orchestrator compact 集成 | context assembly 前执行 micro_compact；manual compact 触发入口 |
| IPC compact 端点 | compact:manual / compact:status |
| Preload compact bridge | 暴露给 renderer |

## 3. 模块设计

### 3.1 micro_compact — `compact.ts`

**核心思路**：在每次 LLM 请求前，对 **内存中的** messages 数组做 view 变换，将距当前 turn 超过 `KEEP_RECENT` 的 tool_result content 替换为占位符。DB 不受影响。

```ts
/**
 * 就地修改 messages 数组中的旧 tool_result，替换为占位符。
 * 仅影响内存副本，不修改 DB。
 *
 * "turn" 定义：一个 UserMessage 及其后续的所有 Assistant/ToolResult messages，
 * 直到下一个 UserMessage。最后一个 turn（即最新的 user prompt 及其后续）
 * 的 turnIndex 最大。
 */
function applyMicroCompact(
  messages: ScorelMessage[],
  keepRecent: number,
): ScorelMessage[]
```

**Turn 计算算法**：

```
输入: messages[] (按 seq 排序)
输出: messages[] (旧 tool_result 被替换)

1. 从后向前扫描，找出所有 UserMessage 的位置
   → 得到 turnBoundaries: number[] (每个元素是 UserMessage 在数组中的 index)

2. 当前 turn = turnBoundaries.length - 1 (最新的 turn)

3. 对每条 message:
   - 计算它属于哪个 turn (二分查找 turnBoundaries)
   - turnDistance = currentTurn - messageTurn
   - 如果 turnDistance > keepRecent 且 message.role === "toolResult":
     → 替换 content 为 [{ type: "text", text: `[Previous: used ${message.toolName}]` }]
     → 清空 details (释放内存)

4. 返回修改后的 messages 数组
```

**关键设计决策**：

| 决策 | 理由 |
|------|------|
| 修改副本而非原始数组 | `getMessages()` 返回的是从 DB 反序列化的新对象，可安全修改；但调用方应意识到这是 destructive view |
| 按 turn 而非按 message 计数 | 一个 tool round 可能产生 5-10 条 message（assistant + N tool_results），按 turn 粒度更符合用户心智模型 |
| 只替换 toolResult | UserMessage 和 AssistantMessage 保留完整内容——它们通常较短，且包含重要决策上下文 |
| placeholder 包含 toolName | 让模型知道"之前用过什么工具"，便于 reasoning |

**应用时机**：

1. **每次 LLM 请求前**：`orchestrator.modelLoop()` 中 `adapter.stream()` 之前
2. **Session resume**：`getMessages()` 后、送入 LLM 前（同一逻辑路径）

### 3.2 manual compact — `compact.ts`

**流程**：

```ts
type ManualCompactResult = {
  compactionId: string;
  summaryText: string;
  boundaryMessageId: string;
  transcriptPath?: string;
};

/**
 * 执行 manual compact：序列化消息 → LLM 摘要 → 持久化 compaction 记录。
 * 调用方负责状态管理（setState compacting → idle/error）。
 */
async function executeManualCompact(opts: {
  sessionId: string;
  messages: ScorelMessage[];
  adapter: ProviderAdapter;
  providerId: string;
  modelId: string;
  db: Database.Database;
  transcriptDir?: string;       // 可选：保存 transcript JSONL 的目录
}): Promise<ManualCompactResult>
```

**内部步骤**：

```
1. serializeForCompact(messages)
   → 角色 + 文本内容，tool_result 截断到 500 chars
   → 拼接为纯文本字符串

2. 截断到 MANUAL_COMPACT_MAX_INPUT (100,000 chars)
   → 如果超长：从头部裁剪，保留最近内容
   → 保证最后一条 message 完整

3. 用 COMPACT_SUMMARY_PROMPT 模板包裹，调用 adapter.complete()
   → 非 streaming 调用（或用 stream 但只收集完整结果）
   → 等待 LLM 返回摘要

4. 确定 boundaryMessageId = messages[messages.length - 1].id
   → compact 边界 = 最后一条被摘要的消息

5. 持久化 compaction 记录 (compactions.ts)
   → insertCompaction(db, { id, sessionId, boundaryMessageId, summaryText, providerId, modelId })

6. 更新 sessions.active_compact_id
   → updateSessionCompact(db, sessionId, compactionId)

7. 可选：保存 transcript JSONL
   → 将完整 messages 以 JSONL 格式写到 transcriptDir/{sessionId}-{compactionId}.jsonl

8. 返回 ManualCompactResult
```

**序列化格式** (`serializeForCompact`)：

```ts
function serializeForCompact(messages: ScorelMessage[]): string
```

```
[User]
How do I fix the login bug?

[Assistant]
Let me look at the auth module.

[Tool Call: read_file]
{"path": "src/auth.ts"}

[Tool Result: read_file]
export function authenticate(user: string, pass: string) {
  // ... (truncated to 500 chars)

[Assistant]
I found the issue. The token expiry check is inverted.
```

规则：
- UserMessage → `[User]\n{content}`
- AssistantMessage → `[Assistant]\n{text parts joined}`，tool_call 部分用 `[Tool Call: {name}]\n{JSON.stringify(args)}`
- ToolResultMessage → `[Tool Result: {toolName}]\n{content truncated to 500 chars}`
- ThinkingPart → 跳过（不含在摘要输入中）

**Summary Prompt**：

```
Summarize the following conversation, preserving:
1. Key decisions and their rationale
2. Files that were created or modified (with paths)
3. Current task status and next steps
4. Any unresolved issues or errors

Be concise but complete. This summary will replace the conversation history.

<conversation>
{serialized_messages}
</conversation>
```

### 3.3 Boundary Resume — context assembly 改造

Manual compact 完成后，后续 LLM 请求的 context 组装逻辑变为：

```
if session.activeCompactId exists:
  compaction = getCompaction(db, activeCompactId)
  boundarySeq = getMessageSeq(db, compaction.boundaryMessageId)

  context = [
    SystemPrompt (instruction layer),
    SyntheticUserMessage("Previous conversation summary:\n" + compaction.summaryText),
    ...messages.filter(m => m.seq > boundarySeq)   // 只保留 boundary 后的消息
  ]
else:
  context = [SystemPrompt, ...allMessages]          // 无 compact，正常发送
```

**Summary 注入方式**：作为 **synthetic UserMessage** 注入到 context 开头（system prompt 之后、真实消息之前）。

理由：
- 不修改 system prompt（保持 instruction layer 纯净）
- UserMessage 是所有 provider 都支持的通用角色
- 模型能清晰区分 "这是之前的摘要" vs "这是当前对话"

**注入消息格式**：

```ts
const summaryMessage: UserMessage = {
  role: "user",
  id: `compact-summary-${compaction.id}`,
  content: `[Previous conversation summary]\n\n${compaction.summaryText}\n\n[End of summary. The conversation continues below.]`,
  ts: compaction.createdAt,
};
```

### 3.4 Compaction CRUD — `compactions.ts`

```ts
type CompactionRecord = {
  id: string;
  sessionId: string;
  boundaryMessageId: string;
  summaryText: string;
  providerId: string;
  modelId: string;
  transcriptPath: string | null;
  createdAt: number;
};

function insertCompaction(db: Database.Database, record: CompactionRecord): void
function getCompaction(db: Database.Database, compactionId: string): CompactionRecord | null
function listCompactions(db: Database.Database, sessionId: string): CompactionRecord[]
function updateSessionCompact(db: Database.Database, sessionId: string, compactId: string | null): void
```

实现要点：
- `insertCompaction` + `updateSessionCompact` 应在同一事务中执行
- `listCompactions` 按 `created_at DESC` 排序（支持查看 compact 历史）
- 删除 session 时 compactions 级联删除（已在 `deleteSession()` 中处理 — 需确认）

### 3.5 Compact Transcript — `compact.ts`

```ts
function saveCompactTranscript(
  dir: string,
  sessionId: string,
  compactionId: string,
  messages: ScorelMessage[],
): string   // 返回文件路径
```

格式复用 export JSONL 的行格式：

```jsonl
{"v":"scorel.compact.v0","type":"compaction","compactionId":"...","sessionId":"...","ts":...}
{"v":"scorel.compact.v0","type":"message","seq":1,"message":{...full message_json}}
{"v":"scorel.compact.v0","type":"message","seq":2,"message":{...}}
...
```

文件路径：`{transcriptDir}/{sessionId}-{compactionId}.jsonl`

transcriptDir 默认为 app userData 下的 `compact-transcripts/` 子目录。

### 3.6 Skill Loader — `skill-loader.ts`

**两层注入架构**：

| 层级 | 时机 | 内容 | 成本 |
|------|------|------|------|
| Layer 1 (metadata) | 每次 LLM 请求 | system prompt 中列出 `name: description` | 极低（几十 token） |
| Layer 2 (full content) | load_skill 调用时 | 完整 SKILL.md 作为 tool_result | 按需付费 |

```ts
type SkillMeta = {
  name: string;
  description: string;
  version: string;
  filePath: string;          // 磁盘上的绝对路径
};

/**
 * 扫描指定目录下的所有 *.md 文件，解析 YAML frontmatter。
 * 跳过解析失败的文件（log warning）。
 */
function scanSkills(skillsDir: string): SkillMeta[]

/**
 * 加载指定 skill 的完整内容（含 frontmatter）。
 * 找不到 → 返回 { isError: true, content: "Unknown skill: {name}" }
 */
function loadSkill(
  skills: SkillMeta[],
  name: string,
): { content: string; isError: boolean }

/**
 * 生成 system prompt 中的 skill 列表片段。
 */
function formatSkillList(skills: SkillMeta[]): string
```

**SKILL.md 格式**：

```markdown
---
name: code-review
description: Perform thorough code review with focus on correctness and style
version: "1.0"
---

# Code Review Skill

When asked to review code, follow these steps:
1. ...
2. ...
```

**YAML Frontmatter 解析**：

```ts
// 使用简单正则 + 手工解析，避免引入 yaml 依赖
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

function parseFrontmatter(content: string): { name?: string; description?: string; version?: string } | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  // 逐行解析 key: value
  // ...
}
```

设计决策：不引入 `yaml` / `gray-matter` 等依赖，用简单 `key: value` 逐行解析即可。SKILL.md 的 frontmatter 只有 3 个固定字段，不需要完整 YAML 解析器。

**错误处理**：

| 场景 | 行为 |
|------|------|
| skills/ 目录不存在 | `scanSkills` 返回空数组，不报错 |
| SKILL.md 无 frontmatter | log warning，跳过该文件 |
| frontmatter 缺少必填字段 (name) | log warning，跳过 |
| `loadSkill("unknown-name")` | 返回 `{ isError: true, content: "Unknown skill: ..." }` |
| SKILL.md 读取失败 (IO error) | 返回 `{ isError: true, content: "Failed to load skill: ..." }` |

### 3.7 load_skill 工具注册 — `tool-dispatch.ts`

**Schema 定义**：

```ts
const loadSkillSchema = {
  name: "load_skill",
  description: "Load a skill file to get detailed instructions for a specific task. Use 'list' as the name to see available skills.",
  parameters: {
    type: "object" as const,
    properties: {
      name: {
        type: "string" as const,
        description: "The skill name to load, or 'list' to see available skills",
      },
    },
    required: ["name"],
  },
};
```

**ToolEntry**：

```ts
["load_skill", {
  name: "load_skill",
  schema: loadSkillSchema,
  approval: "allow",      // 无副作用，无需审批
  timeoutMs: 5_000,       // 本地文件读取，5s 足够
}]
```

**执行路径**：

load_skill 与其他 4 个工具不同——它不走 Runner 进程，而是 **在 Core 侧直接执行**（读本地文件，无安全风险，无需隔离）。

这意味着 `orchestrator.executeToolCalls()` 需要分流：

```
for each toolCall:
  if toolCall.name === "load_skill":
    → 直接调用 skillLoader.loadSkill() → 构造 ToolResult
  else:
    → 走 toolRunner.execute() → Runner 进程
```

理由：
- SKILL.md 在应用资源目录，不在 workspace 中，Runner 无权访问
- 避免 Runner 需要知道 skills 路径的耦合
- 无需审批、无安全隔离需求

## 4. 集成改造

### 4.1 Orchestrator 改造

**改动 1：context assembly 加入 micro_compact + boundary resume**

```
modelLoop():
  // --- 现有 ---
  messages = sessionManager.getMessages(sessionId)

  // --- 新增：boundary resume ---
  session = sessionManager.get(sessionId)
  if session.activeCompactId:
    compaction = getCompaction(db, session.activeCompactId)
    boundarySeq = lookupBoundarySeq(messages, compaction.boundaryMessageId)
    messages = messages.filter(m => m.seq > boundarySeq)
    messages = [makeSummaryMessage(compaction), ...messages]

  // --- 新增：micro_compact ---
  messages = applyMicroCompact(messages, MICRO_COMPACT_KEEP_RECENT)

  // --- 现有 ---
  adapter.stream(systemPrompt, messages, tools, ...)
```

**改动 2：executeToolCalls 分流 load_skill**

```ts
async executeToolCalls(toolCalls: ToolCall[]): Promise<void> {
  for (const toolCall of toolCalls) {
    // ... approval 逻辑不变 ...

    let result: ToolResult;
    if (toolCall.name === "load_skill") {
      // Core 侧直接执行
      result = this.executeLoadSkill(toolCall.args);
    } else {
      // Runner 进程执行
      result = await this.toolRunner.execute(...);
    }

    // ... persist ToolResultMessage 不变 ...
  }
}
```

**改动 3：新增 manualCompact() 方法**

```ts
async manualCompact(sessionId: string): Promise<ManualCompactResult> {
  // 1. 校验状态（必须 idle）
  // 2. setState("compacting")
  // 3. 获取 messages
  // 4. 调用 executeManualCompact()
  // 5. emit compact.manual event
  // 6. setState("idle")
  // 异常时 emit compact.failed, setState("idle")
}
```

**改动 4：assembleSystemPrompt 加入 skill 元数据**

```ts
assembleSystemPrompt(session: SessionDetail): string {
  let prompt = DEFAULT_SYSTEM_PROMPT;
  prompt += `\n\nWorkspace: ${session.workspaceRoot}`;

  // --- 新增 ---
  if (this.skills.length > 0) {
    prompt += `\n\n${formatSkillList(this.skills)}`;
  }

  if (session.pinnedSystemPrompt) {
    prompt += `\n\n${session.pinnedSystemPrompt}`;
  }
  return prompt;
}
```

### 4.2 SessionManager 改造

新增方法：

```ts
/** 获取指定消息的 seq（用于 boundary 查找） */
getMessageSeq(sessionId: string, messageId: string): number | null

/** 更新 session 的 active_compact_id */
setActiveCompact(sessionId: string, compactId: string | null): void
```

### 4.3 IPC 层变更

**Preload 新增**：

```ts
compact: {
  manual: (sessionId: string) =>
    ipcRenderer.invoke("compact:manual", sessionId),
},
```

**IPC Handler 新增**：

```ts
ipcMain.handle("compact:manual", async (_event, sessionId) => {
  return orchestrator.manualCompact(sessionId);
});
```

注意：manual compact 可能耗时较长（LLM 调用），IPC handler 应返回 Promise。Renderer 侧显示 loading 状态。

### 4.4 Tool Dispatch 改造

```ts
// 新增到 TOOL_REGISTRY
["load_skill", {
  name: "load_skill",
  schema: loadSkillSchema,
  approval: "allow",
  timeoutMs: 5_000,
}]
```

`getToolDefinitions()` 自动包含新工具，无需额外改动。

### 4.5 main/index.ts Bootstrap 改造

```ts
// --- 新增 ---
import { scanSkills } from "./skills/skill-loader";

// 在 Orchestrator 创建前
const skills = scanSkills(path.join(app.getAppPath(), "skills"));

// 传入 Orchestrator
const orchestrator = new Orchestrator({
  sessionManager,
  providerMap,
  eventBus,
  skills,      // 新增
  db,          // 新增（用于 compaction CRUD）
});
```

## 5. 数据流

### 5.1 micro_compact 流程

```
Orchestrator.modelLoop()
  → sessionManager.getMessages(sessionId)        // DB 读取完整消息
  → [boundary resume filtering]                    // 如有 compact，裁剪到 boundary 后
  → applyMicroCompact(messages, 3)                // 替换旧 tool_result
      ├─ turn 计算：扫描 UserMessage 位置
      ├─ turnDistance > 3 的 ToolResultMessage：
      │   content → [{ type: "text", text: "[Previous: used read_file]" }]
      │   details → undefined
      └─ 返回修改后的 messages（浅拷贝）
  → adapter.stream(systemPrompt, messages, ...)   // 发送给 LLM
```

### 5.2 manual compact 流程

```
Renderer: 用户点击 Compact 按钮
  → scorel.compact.manual(sessionId)
  → IPC → orchestrator.manualCompact(sessionId)
    1. assert state === "idle"
    2. setState("compacting")
    3. messages = getMessages(sessionId)
    4. serialized = serializeForCompact(messages)
       → 截断到 100,000 chars（trim oldest）
    5. summaryText = await adapter.complete(COMPACT_SUMMARY_PROMPT + serialized)
    6. boundaryMessageId = messages[last].id
    7. BEGIN TRANSACTION
       a. insertCompaction(db, { id, sessionId, boundaryMessageId, summaryText, ... })
       b. updateSessionCompact(db, sessionId, compactionId)
       COMMIT
    8. saveCompactTranscript(...) // optional, best-effort
    9. emit("compact.manual", { sessionId, summaryMessageId: compactionId, transcriptPath })
   10. setState("idle")
   11. 返回 ManualCompactResult
  → IPC → Renderer: 显示成功提示

异常分支：
  步骤 5 LLM 调用失败
    → emit("compact.failed", { sessionId, error: message })
    → setState("idle")
    → throw → IPC → Renderer: 显示错误提示
```

### 5.3 load_skill 流程

```
LLM 输出: tool_use load_skill { name: "code-review" }
  → orchestrator.executeToolCalls()
    → toolCall.name === "load_skill"
      → skillLoader.loadSkill(skills, "code-review")
        → 在 skills[] 中查找 name === "code-review"
        → fs.readFile(skill.filePath)
        → return { content: fullFileContent, isError: false }
      → persist ToolResultMessage (content = SKILL.md 全文)
  → modelLoop 继续 → LLM 获得 skill 内容 → 按指令执行
```

### 5.4 Boundary Resume 流程

```
Session resume / new turn after compact:
  → getMessages(sessionId) → [msg1, msg2, ..., msg_boundary, msg_new1, msg_new2]
  → session.activeCompactId exists
    → compaction = getCompaction(db, activeCompactId)
    → boundarySeq = 找到 boundary_message_id 对应的 seq
    → 过滤: 只保留 seq > boundarySeq 的消息
    → 在前面插入 summaryMessage (synthetic UserMessage)
  → context = [summaryMessage, msg_new1, msg_new2]
  → applyMicroCompact(context, 3) → 对 post-boundary 消息也做 micro_compact
  → 发送给 LLM
```

## 6. 类型定义新增

### `src/shared/types.ts` 新增

```ts
/** Compaction record persisted in DB */
type CompactionRecord = {
  id: string;
  sessionId: string;
  boundaryMessageId: string;
  summaryText: string;
  providerId: string;
  modelId: string;
  transcriptPath: string | null;
  createdAt: number;
};

/** Result of manual compact operation */
type ManualCompactResult = {
  compactionId: string;
  summaryText: string;
  boundaryMessageId: string;
  transcriptPath?: string;
};

/** Skill metadata parsed from YAML frontmatter */
type SkillMeta = {
  name: string;
  description: string;
  version: string;
  filePath: string;
};
```

### `src/shared/events.ts` 确认

已定义的事件无需改动：

```ts
| { type: "compact.manual"; sessionId: string; ts: number; summaryMessageId: string; transcriptPath?: string }
| { type: "compact.failed"; sessionId: string; ts: number; error: string }
```

## 7. 示例 SKILL.md

### `skills/code-review.md`

```markdown
---
name: code-review
description: Perform thorough code review with focus on correctness, style, and security
version: "1.0"
---

# Code Review

When performing a code review:

1. Read the file(s) to review using read_file
2. Check for:
   - Logic errors and edge cases
   - Security vulnerabilities (injection, XSS, auth bypass)
   - Code style consistency
   - Error handling completeness
3. Provide specific, actionable feedback with line references
4. Suggest concrete code changes using edit_file when appropriate
```

### `skills/test-writer.md`

```markdown
---
name: test-writer
description: Write comprehensive unit and integration tests
version: "1.0"
---

# Test Writer

When writing tests:

1. Read the source file to understand the API surface
2. Identify test cases: happy path, edge cases, error conditions
3. Use the project's test framework (check package.json)
4. Write tests using write_file
5. Run tests using bash to verify they pass
6. Aim for meaningful coverage, not just line coverage
```

## 8. 测试策略

### 单元测试

| 测试文件 | 覆盖范围 | 关键用例 |
|---------|---------|---------|
| `tests/unit/micro-compact.test.ts` | `applyMicroCompact()` | turn 计算正确性；keepRecent=3 保留近 3 轮；只替换 toolResult；placeholder 格式；空消息数组；全是 user 消息（无 tool） |
| `tests/unit/manual-compact.test.ts` | `serializeForCompact()`, `executeManualCompact()` | 序列化格式正确；truncation 到 100k chars；LLM 调用失败时抛出；compaction 记录持久化；transcript 保存 |
| `tests/unit/compactions.test.ts` | CRUD 函数 | insert + get 往返；listCompactions 排序；updateSessionCompact 事务性；级联删除 |
| `tests/unit/skill-loader.test.ts` | `scanSkills()`, `loadSkill()`, `formatSkillList()` | 正常解析；无 frontmatter 跳过；缺字段跳过；目录不存在返回空；unknown skill 错误；IO 错误处理 |
| `tests/unit/boundary-resume.test.ts` | context assembly with compact | 有 compact 时只含 boundary 后消息 + summary；无 compact 时全量；summary 格式正确 |

### 集成测试

| 测试文件 | 覆盖范围 |
|---------|---------|
| `tests/integration/compact-flow.test.ts` | 完整流程：10 轮 tool 对话 → micro_compact 验证 → manual compact → boundary resume → 新消息只含 summary + 新内容 |
| `tests/integration/skill-flow.test.ts` | load_skill tool call → skill 内容返回 → model 获得 skill 指令 |

### 验收标准对照

| Spec 要求 | 验证方式 |
|-----------|---------|
| Case I: Manual compact → new messages → resume → 只含 boundary 后 + summary | 集成测试：compact → send new message → 检查 LLM 收到的 context |
| micro_compact: 10 轮后旧 tool_result 显示 placeholder | 单元测试：构造 10 轮消息 → applyMicroCompact → 验证前 7 轮的 toolResult 被替换 |
| Manual compact: summary 生成、transcript 保存、session 继续 | 集成测试：触发 compact → 验证 DB compaction 记录 + transcript 文件 + 后续对话正常 |
| Compact failure: session 继续、error 显示 | 单元测试：mock adapter 返回错误 → 验证 state 回到 idle + compact.failed 事件 |
| load_skill: 列出可用 skills 并按需加载 | 单元测试：scanSkills → 验证 meta list；loadSkill("name") → 验证返回全文 |
| Unknown skill: error tool_result | 单元测试：loadSkill("nonexistent") → isError: true |
| Search 找到 pre-compact 内容 | 集成测试：compact 后搜索 → FTS 仍能命中旧消息 |

## 9. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/core/compact.ts` | **新建** | applyMicroCompact() + serializeForCompact() + executeManualCompact() + saveCompactTranscript() |
| `src/main/storage/compactions.ts` | **新建** | CompactionRecord CRUD: insert / get / list / updateSessionCompact |
| `src/main/skills/skill-loader.ts` | **新建** | scanSkills() + loadSkill() + formatSkillList() + parseFrontmatter() |
| `skills/code-review.md` | **新建** | 示例 SKILL.md |
| `skills/test-writer.md` | **新建** | 示例 SKILL.md |
| `src/shared/types.ts` | 修改 | 新增 CompactionRecord, ManualCompactResult, SkillMeta |
| `src/main/core/orchestrator.ts` | 修改 | context assembly 加入 micro_compact + boundary resume；executeToolCalls 分流 load_skill；新增 manualCompact()；assembleSystemPrompt 加入 skill list |
| `src/main/core/session-manager.ts` | 修改 | 新增 getMessageSeq(), setActiveCompact() |
| `src/main/core/tool-dispatch.ts` | 修改 | 新增 load_skill ToolEntry + schema |
| `src/main/ipc-handlers.ts` | 修改 | 新增 compact:manual handler |
| `src/preload/index.ts` | 修改 | 新增 compact.manual bridge |
| `src/main/index.ts` | 修改 | Bootstrap: scanSkills, 传入 Orchestrator |
| `tests/unit/micro-compact.test.ts` | **新建** | micro_compact 算法测试 |
| `tests/unit/manual-compact.test.ts` | **新建** | manual compact 流程测试 |
| `tests/unit/compactions.test.ts` | **新建** | compaction CRUD 测试 |
| `tests/unit/skill-loader.test.ts` | **新建** | skill 扫描/加载测试 |
| `tests/unit/boundary-resume.test.ts` | **新建** | boundary resume context assembly 测试 |
| `tests/integration/compact-flow.test.ts` | **新建** | 端到端 compact 流程 |
| `tests/integration/skill-flow.test.ts` | **新建** | 端到端 skill 加载流程 |

## 10. 性能考量

### micro_compact 开销

每次 LLM 请求前执行一次 `applyMicroCompact()`。算法复杂度 O(n)（n = 消息数），对 100 条消息约 < 1ms。主要成本是数组遍历 + 字符串替换，可忽略不计。

### manual compact LLM 调用

compact summary 是一次完整 LLM 调用，输入上限 100k chars。预计耗时 5-30s 取决于 provider/model。UI 需显示 loading 状态。

如果 LLM 调用超时或失败，session 回到 idle 状态，用户可重试。不会丢失任何数据（非破坏性）。

### Skill 扫描

`scanSkills()` 在应用启动时执行一次，读取 skills/ 目录下所有 .md 文件。对 10 个以内的 skill 文件，耗时 < 50ms。不需要 watch 机制（V0 不支持热加载 skills）。

### Boundary resume 查询

`getMessages()` 返回全量消息后在内存中过滤（filter by seq > boundarySeq）。另一种方案是在 SQL 层过滤（`WHERE seq > ?`），但 V0 session 消息量（< 10k）不构成瓶颈，内存过滤更简单。

## 11. 与 Spec 的偏差

| Spec 要求 | 计划处理 | 原因 |
|-----------|---------|------|
| `load_skill` 在 Runner 执行 | Core 侧直接执行 | SKILL.md 在应用资源目录，不在 workspace 中；无安全隔离需求；避免 Runner 知道 skills 路径 |
| Compact transcript "optional" | 默认不保存，需显式传入 transcriptDir | V0 先不默认生成 transcript 文件，减少 disk IO；用户需要时可通过配置开启 |
| `load_skill("list")` 列出 skills | 作为 name="list" 的特殊 case 处理 | 虽然 system prompt 已包含 skill 列表，但 "list" 提供明确的 tool 交互方式，model 可能在 layer 1 信息不够时主动调用 |
| YAML frontmatter 用 yaml 库解析 | 手工 key: value 逐行解析 | 避免引入新依赖；frontmatter 只有 3 个固定字段 |

## 12. 已知限制

- **Compact 不可逆转（UI 层面）**：虽然 DB 中消息完整保留，但 `active_compact_id` 一旦设置，没有 UI 操作来"取消 compact"回到全量 context。技术上可通过设置 `active_compact_id = null` 恢复，但 V0 不暴露此操作。
- **多次 compact**：当前设计每次 compact 覆盖 `active_compact_id`。如果用户在 compact 后继续长时间对话再次 compact，旧 compact 记录保留但不再 active。summary 只覆盖最近一次 compact 前的内容，不递归包含之前的 summary。
- **Summary 质量依赖 LLM**：如果使用较弱的 model 做 compact，summary 可能丢失关键细节。V0 使用 session 当前的 active model 做 compact，不提供单独选择 model 的能力。
- **Skill 热加载**：V0 启动时扫描一次 skills/ 目录，运行期间新增/修改 SKILL.md 不会自动生效。需重启应用。
- **Skill 无 workspace 级别**：V0 只支持全局 skills/ 目录（应用资源内），不支持 workspace 级别的 skills。
- **Compact 期间不可发送消息**：session 进入 "compacting" 状态时，`send()` 校验会拒绝。用户需等待 compact 完成。
- **micro_compact 不影响 token 计数 UI**：UI 显示的 token usage 是 LLM 返回的实际 usage，已经包含了 micro_compact 的效果。但用户无法直观看到 "省了多少 token"。
