# M3 History & Search — 设计与技术文档

> 状态：待实现 | 基于 V0-M3 spec

## 1. 目标

在 M1/M1.5（streaming）+ M2（tool execution）基础上，补全持久化层的最后一块：
全文搜索、会话导出、归档/删除生命周期。

## 2. 现状盘点

### 已就绪

| 组件 | 状态 | 说明 |
|------|------|------|
| SQLite schema v1 | ✅ | providers / sessions / messages / compactions / events / messages_fts / embeddings 全部建表 |
| FTS5 同步写入 | ✅ | `insertMessage()` 在同一事务中写 messages + messages_fts |
| `extractSearchableText()` | ✅ | user 全文、assistant text parts 拼接、toolResult 截断到 `FTS_CONTENT_MAX_CHARS`(2000) |
| Session CRUD | ✅ | create / get / list / rename / archive / delete（含级联删除 messages + events + fts + compactions） |
| EventLog JSONL | ✅ | append-only 写入，best-effort |
| `EXPORT_VERSION` 常量 | ✅ | `"scorel.export.v0"` |
| `FTS_CONTENT_MAX_CHARS` 常量 | ✅ | 2000 |

### 待实现

| 功能 | 说明 |
|------|------|
| `SearchResult` 类型 | 含 snippet / highlight / session context |
| FTS 查询函数 | `searchMessages(db, query)` → `SearchResult[]` |
| 导出 JSONL | 完整 `message_json` + session metadata header |
| 导出 Markdown | 人类可读格式，tool call 用 blockquote |
| 脱敏导出 | mask `sk-*`、`Bearer *`、home paths |
| Unarchive | 当前只有 archive，缺 unarchive |
| Preload search IPC | `search.query` bridge |
| IPC handlers | search / export / unarchive |

## 3. 模块设计

### 3.1 SearchResult 类型

新增到 `src/shared/types.ts`：

```ts
type SearchResult = {
  messageId: string;
  sessionId: string;
  sessionTitle: string | null;
  role: string;
  snippet: string;       // FTS5 snippet() 带高亮标记
  ts: number;
  seq: number;
};
```

### 3.2 FTS 查询 — `db.ts` 新增

```ts
function searchMessages(
  db: Database.Database,
  query: string,
  opts?: { sessionId?: string; limit?: number },
): SearchResult[]
```

实现要点：

- 使用 FTS5 的 `snippet()` 函数生成带高亮的摘要
- snippet 标记：`<mark>` / `</mark>`（renderer 侧渲染）
- JOIN sessions 表获取 sessionTitle
- JOIN messages 表获取 role / seq / ts
- 默认 limit 50，上限 200
- 支持按 sessionId 过滤（单 session 内搜索）
- FTS5 query 直接传入（支持 AND / OR / NOT / 前缀 `*`）

SQL 核心：

```sql
SELECT
  m.id AS message_id,
  m.session_id,
  s.title AS session_title,
  m.role,
  snippet(messages_fts, 2, '<mark>', '</mark>', '...', 32) AS snippet,
  m.ts,
  m.seq
FROM messages_fts AS fts
JOIN messages AS m ON m.id = fts.message_id
JOIN sessions AS s ON s.id = m.session_id
WHERE messages_fts MATCH ?
  AND (? IS NULL OR m.session_id = ?)
ORDER BY rank
LIMIT ?
```

注意：FTS5 的 `snippet()` 第一个参数是 FTS 表名，第二个是列索引（content 列 = 2，因为 session_id=0, message_id=1, content=2）。

### 3.3 导出 JSONL — `session-manager.ts` 新增

```ts
function exportJsonl(sessionId: string, opts?: { redact?: boolean }): string
```

格式：
```jsonl
{"v":"scorel.export.v0","type":"session","session":{...sessionSummary}}
{"v":"scorel.export.v0","type":"message","seq":1,"message":{...full message_json}}
{"v":"scorel.export.v0","type":"message","seq":2,"message":{...}}
...
```

- 第一行：session metadata（id / title / createdAt / workspaceRoot / provider / model）
- 后续行：每条 message 的完整 `message_json`（不做 micro_compact 截断）
- `redact` 模式：对每行 JSON 字符串做正则替换

### 3.4 导出 Markdown — `session-manager.ts` 新增

```ts
function exportMarkdown(sessionId: string, opts?: { redact?: boolean }): string
```

格式：

```markdown
# Session: {title || "Untitled"}

- Created: {ISO date}
- Workspace: {workspaceRoot}
- Provider: {providerId} / {modelId}

---

## User

{content}

## Assistant

{text parts joined}

> **Tool Call**: bash
> ```json
> {"command": "ls -la"}
> ```

## Tool Result: bash

{content, truncated to 500 chars}

---

## User

...
```

规则：
- tool call 用 blockquote + code block
- tool result content 截断到 500 chars（`MANUAL_COMPACT_TOOL_RESULT_PREVIEW`）
- thinking parts 用 `<details>` 折叠
- 分隔符 `---` 在每个 user turn 前

### 3.5 脱敏 — `redact.ts` 新增

```ts
function redactString(input: string): string
```

替换规则：

| 模式 | 替换为 |
|------|--------|
| `sk-[A-Za-z0-9]{20,}` | `sk-***REDACTED***` |
| `Bearer [A-Za-z0-9._-]+` | `Bearer ***REDACTED***` |
| `process.env.HOME` / `os.homedir()` 路径 | `~` |
| `/Users/{username}/` | `~/` |

应用于 JSONL 和 Markdown 导出的最终字符串。

### 3.6 Unarchive — `db.ts` + `session-manager.ts`

```ts
// db.ts
function unarchiveSession(db, sessionId): void {
  db.prepare("UPDATE sessions SET archived = 0, updated_at = ? WHERE id = ?")
    .run(now(), sessionId);
}

// session-manager.ts
unarchive(sessionId: string): void {
  dbUnarchiveSession(this.db, sessionId);
}
```

### 3.7 FTS Rebuild（debug 命令）

```ts
// db.ts
function rebuildFts(db: Database.Database): void {
  db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
}
```

用于数据修复场景，不暴露给普通用户。

## 4. IPC 层变更

### 4.1 Preload 新增

```ts
search: {
  query: (query: string, opts?: { sessionId?: string; limit?: number }) =>
    ipcRenderer.invoke("search:query", query, opts),
},
sessions: {
  // 新增
  unarchive: (sessionId: string) =>
    ipcRenderer.invoke("sessions:unarchive", sessionId),
  exportJsonl: (sessionId: string, opts?: { redact?: boolean }) =>
    ipcRenderer.invoke("sessions:exportJsonl", sessionId, opts),
  exportMarkdown: (sessionId: string, opts?: { redact?: boolean }) =>
    ipcRenderer.invoke("sessions:exportMarkdown", sessionId, opts),
},
```

### 4.2 IPC Handlers 新增

```ts
// ipc-handlers.ts
ipcMain.handle("search:query", async (_event, query, opts) => {
  return searchMessages(db, query, opts);
});

ipcMain.handle("sessions:unarchive", async (_event, sessionId) => {
  sessionManager.unarchive(sessionId);
});

ipcMain.handle("sessions:exportJsonl", async (_event, sessionId, opts) => {
  return sessionManager.exportJsonl(sessionId, opts);
});

ipcMain.handle("sessions:exportMarkdown", async (_event, sessionId, opts) => {
  return sessionManager.exportMarkdown(sessionId, opts);
});
```

## 5. 数据流

### 搜索流程

```
Renderer: search input → scorel.search.query(keyword)
  → IPC → ipcMain "search:query"
    → searchMessages(db, keyword)
      → FTS5 MATCH + snippet() + JOIN sessions/messages
    → SearchResult[]
  → IPC → Renderer: render results with <mark> highlights
```

### 导出流程

```
Renderer: export button → scorel.sessions.exportJsonl(sessionId, { redact })
  → IPC → ipcMain "sessions:exportJsonl"
    → sessionManager.exportJsonl(sessionId, { redact })
      → getSession() → getMessages() → serialize → redact?
    → string (JSONL content)
  → IPC → Renderer: trigger download / save dialog
```

注意：导出返回字符串而非写文件。Renderer 侧通过 Blob + download 或 Electron dialog.showSaveDialog 保存。
大文件场景（>10MB）可能需要改为流式写入 + 返回文件路径，但 V0 先用字符串返回。

## 6. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/shared/types.ts` | 修改 | 新增 `SearchResult` 类型 |
| `src/main/storage/db.ts` | 修改 | 新增 `searchMessages()`、`unarchiveSession()`、`rebuildFts()` |
| `src/main/core/session-manager.ts` | 修改 | 新增 `unarchive()`、`exportJsonl()`、`exportMarkdown()` |
| `src/main/core/redact.ts` | 新建 | 脱敏函数 |
| `src/main/ipc-handlers.ts` | 修改 | 新增 search / unarchive / export handlers |
| `src/preload/index.ts` | 修改 | 新增 search / unarchive / export bridges |
| `tests/unit/search.test.ts` | 新建 | FTS 查询测试 |
| `tests/unit/export.test.ts` | 新建 | JSONL / Markdown 导出测试 |
| `tests/unit/redact.test.ts` | 新建 | 脱敏测试 |

## 7. 验收标准对照

| Spec 要求 | 实现方案 | 验证方式 |
|-----------|---------|---------|
| FTS 10k message < 200ms | FTS5 MATCH + rank 排序 + LIMIT | 单元测试：插入 10k 条消息后计时查询 |
| Export JSONL re-importable | 每行 valid JSON，首行 session metadata | 单元测试：导出 → 逐行 JSON.parse → 校验 schema |
| Export Markdown human-readable | tool calls as blockquotes，truncated results | 单元测试：导出 → 检查格式标记 |
| Archive/unarchive | `archived` flag toggle | 已有测试 + 新增 unarchive 测试 |
| Delete cascades | 事务内删除 messages + events + fts + compactions + sessions | 已有测试覆盖 |

## 8. 性能考量

### FTS5 写入开销

当前 `insertMessage()` 在同一事务中同步写入 FTS。对于 tool loop 密集场景（一次 turn 可能产生 5-10 条 message），事务内的 FTS 写入是 O(n) 但常数很小（FTS5 的 B-tree 插入）。

如果未来发现写入瓶颈，可以改为：
1. 批量写入：收集一个 turn 的所有 messages，一次事务写入
2. 异步 FTS：先写 messages 表，后台线程补写 FTS（但会导致搜索延迟）

V0 保持同步写入，简单可靠。

### 导出大 session

10k 条消息的 JSONL 导出约 5-20MB（取决于 tool output 大小）。字符串拼接在 V8 中对这个量级没有问题。如果单 session 超过 50MB，需要改为流式写入。V0 不做此优化。

## 9. 与 Spec 的偏差

| Spec 提到 | 计划处理 |
|-----------|---------|
| "versioned migration scripts" in `migrations/` | 当前 schema v1 内联在 db.ts 的 `SCHEMA_V1` 中，migration runner 通过 `user_version` pragma 控制。V0 只有一个版本，不需要独立 migration 文件。如果 M3 需要 schema 变更（目前看不需要），再提取。 |
| "search UI, export buttons" in renderer | M3 spec 列出了 renderer 修改，但 renderer UI 不是 M3 的核心交付。后端 API 就绪后，UI 可以在 M5 或独立 UI sprint 中补。本文档聚焦后端实现。 |
| FTS rebuild as "debug command" | 暴露为 `rebuildFts()` 函数，不注册 IPC。开发者通过 DevTools console 或测试调用。 |

## 10. 已知限制

- **FTS5 不支持中文分词**：默认 tokenizer 按空格/标点分词，中文搜索需要连续字符匹配。如需中文支持，需要编译 `simple` 或 `jieba` tokenizer 扩展。V0 不处理。
- **导出不含 events**：JSONL 导出只含 messages，不含 ScorelEvent 事件流。EventLog JSONL 是独立文件，需要用户手动获取。
- **脱敏不完美**：正则替换无法覆盖所有敏感信息模式（如自定义 header 中的 token）。V0 做 best-effort。
- **搜索不跨 compact 边界**：manual compact 后，旧消息的 FTS 条目保留，但 summary 也会有新条目。搜索可能返回 compact 前后的重复语义内容。
