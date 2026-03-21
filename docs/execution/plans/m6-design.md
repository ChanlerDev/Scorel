# M6 Dogfood Fixes — 设计与技术文档

> 状态：待实现 | 基于 V0-M6 spec | 来源：首次 dogfood 发现

## 1. 目标

M1–M5 完成了完整的 streaming、tool execution、history、compact、打包发布流程。首次 dogfood 暴露了四个 UI 层面的缺失，导致用户无法完成基本操作循环：

1. **审批按钮缺失**：M2 的 approval 后端完整，但 UI 没有 approve/deny 按钮，工具调用流程断裂
2. **Markdown 渲染缺失**：assistant 输出为纯文本，代码块/列表/粗体无法渲染
3. **Settings 面板缺失**：首次配置后无法修改 provider 配置
4. **Workspace UX 摩擦**：每次 New Chat 必须弹原生文件夹选择器

M6 的目标是修复这四项，让 V0 从"demo 能跑"升级为"真正可用"。

## 2. 现状盘点

### 已就绪（可直接使用）

| 组件 | 位置 | 说明 |
|------|------|------|
| `tools.approve` / `tools.deny` IPC | `preload/index.ts:76-80` | Bridge 已暴露，IPC handler 已注册 |
| `orchestrator.approveToolCall()` / `denyToolCall()` | `orchestrator.ts` | 后端审批方法已实现 |
| `useChat` 审批事件处理 | `hooks/useChat.ts:93-119` | 正确处理 `approval.requested` / `approval.resolved` 事件 |
| `toolStatuses` 状态追踪 | `hooks/useChat.ts:28` | 按 toolCallId 追踪工具状态 |
| `toolStatusLabel()` + 黄点渲染 | `MessageList.tsx:7-73` | 状态文字 + 脉动圆点已渲染，仅缺按钮 |
| `providers.upsert` / `delete` / `testConnection` IPC | `ipc-handlers.ts:136-183` | Provider CRUD + 测试连接后端就绪 |
| `secrets.store` / `has` / `clear` IPC | `ipc-handlers.ts:187-200` | 密钥管理后端就绪 |
| `SetupWizard` 表单组件 | `setup-wizard.tsx` | Configure + Test 步骤可复用 |
| `setup-wizard-model.ts` | `components/` | Provider preset + draft 验证逻辑可复用 |
| CSS custom properties 主题系统 | `theme.css` (M5) | `var(--bg-primary)` 等变量已全局生效 |
| `sessions.create({ workspaceRoot })` | `ipc-handlers.ts:42-49` | 创建 session 已接受 workspaceRoot |
| `ScorelBridge` 完整类型 | `global.d.ts` | 所有 IPC 方法已声明 |

### 待实现

| 组件 | 说明 |
|------|------|
| Approve / Deny 按钮 | `MessageList.tsx` 中 `awaiting_approval` 状态下渲染交互按钮 |
| sessionId 传递到 MessageList | 当前 MessageList 不接收 sessionId，无法调用 `tools.approve(sessionId, ...)` |
| Markdown 渲染库 | `react-markdown` 或等价方案 |
| Assistant 消息 Markdown 渲染 | 替换 `renderContentPart` 中 TextPart 的 `<span>` 为 Markdown 组件 |
| XSS 防护 | 确保 LLM 输出中的 `<script>` 等标签不执行 |
| `SettingsView.tsx` | Provider 列表 + 编辑表单 + API key 更新 + 测试连接 |
| Settings 路由 / 导航 | App.tsx 中 sidebar 添加 Settings 入口 |
| Cmd+, 快捷键 | 菜单快捷键打开 Settings |
| App 默认 workspace | 首次启动创建 `~/Scorel` 目录 |
| `workspaces` 表 | SQLite 新表，记录工作区历史 |
| Workspace IPC | 工作区 CRUD + 历史查询 |
| New Chat 工作区选择器 | 替换当前的 `selectDirectory()` 调用 |

## 3. 模块设计

### 3.1 D1: Approval 按钮 — `MessageList.tsx` 改造

**问题根因**：`MessageList` 渲染了工具调用状态（黄点 + "Awaiting approval" 文字），但没有 approve/deny 按钮。`renderContentPart` 收到 `toolStatuses`，能判断 `state === "awaiting_approval"`，但缺少按钮 JSX 和调用 `window.scorel.tools.approve/deny` 的 sessionId。

**方案**：

1. `MessageList` 新增 `sessionId` prop
2. `ChatView` 将 `sessionId` 传入 `MessageList`
3. `renderContentPart` 在 `state === "awaiting_approval"` 时渲染 Approve / Deny 按钮

**改造细节**：

```tsx
// MessageList.tsx — renderContentPart 中 toolCall case 新增

{status?.state === "awaiting_approval" && sessionId && (
  <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
    <button
      onClick={() => void window.scorel.tools.approve(sessionId, part.id)}
      style={{
        padding: "4px 12px",
        borderRadius: 8,
        border: "none",
        background: "var(--success)",
        color: "#fff",
        cursor: "pointer",
        fontSize: 12,
      }}
    >
      Approve
    </button>
    <button
      onClick={() => void window.scorel.tools.deny(sessionId, part.id)}
      style={{
        padding: "4px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
        cursor: "pointer",
        fontSize: 12,
      }}
    >
      Deny
    </button>
  </div>
)}
```

**Props 变更**：

```tsx
// MessageList — 新增 sessionId
export function MessageList({
  messages,
  streamingMessage,
  searchNavigationTarget,
  toolStatuses,
  sessionId,          // 新增
}: {
  messages: ScorelMessage[];
  streamingMessage: AssistantMessage | null;
  searchNavigationTarget: SearchNavigationTarget | null;
  toolStatuses: Record<string, ToolStatus>;
  sessionId: string;  // 新增
})
```

```tsx
// renderContentPart — 新增 sessionId 参数
function renderContentPart(
  part: ContentPart,
  idx: number,
  toolStatuses: Record<string, ToolStatus>,
  sessionId: string,  // 新增
)
```

**ChatView 改造**：

```tsx
// ChatView.tsx — 传入 sessionId
<MessageList
  messages={messages}
  streamingMessage={streamingMessage}
  searchNavigationTarget={searchNavigationTarget}
  toolStatuses={toolStatuses}
  sessionId={sessionId}          // 新增
/>
```

**防重复点击**：按钮 onClick 后立即由 `useChat` 的 `approval.resolved` 事件驱动状态变更为 `running` 或 `denied`，按钮自然消失（不再是 `awaiting_approval`）。无需额外 disable 逻辑。

### 3.2 D2: Markdown 渲染

**问题根因**：`renderContentPart` 的 TextPart 分支直接渲染为 `<span style={{ whiteSpace: "pre-wrap" }}>{part.text}</span>`，无 Markdown 解析。

**方案选型**：

| 选项 | 包大小 | React 原生 | XSS 安全 | 选择 |
|------|--------|-----------|---------|------|
| `react-markdown` + `remark-gfm` | ~80KB | 是 | 默认安全（不渲染原始 HTML） | **✅ 采用** |
| `marked` + `DOMPurify` + `dangerouslySetInnerHTML` | ~50KB | 否 | 需手动配置 | ✗ |
| 自写正则 | 0KB | 是 | 需手动处理 | ✗ 不现实 |

`react-markdown` 默认 **不渲染原始 HTML 标签**（`<script>` 等会被当作文本显示），天然安全。配合 `remark-gfm` 支持 GFM 表格、删除线、任务列表。

**改造**：

```tsx
// MessageList.tsx — TextPart 分支

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 替换原有的 <span>
case "text":
  return (
    <div key={idx} className="scorel-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {part.text}
      </ReactMarkdown>
    </div>
  );
```

**样式**：需要为 `.scorel-markdown` 内的元素添加基础排版样式。在 `theme.css` 中新增：

```css
.scorel-markdown {
  line-height: 1.6;
  word-break: break-word;
}

.scorel-markdown pre {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
  font-size: 13px;
}

.scorel-markdown code {
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 0.9em;
}

.scorel-markdown :not(pre) > code {
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
}

.scorel-markdown p {
  margin: 0 0 8px 0;
}

.scorel-markdown p:last-child {
  margin-bottom: 0;
}

.scorel-markdown ul, .scorel-markdown ol {
  padding-left: 20px;
  margin: 4px 0;
}

.scorel-markdown table {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
}

.scorel-markdown th, .scorel-markdown td {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
}

.scorel-markdown th {
  background: var(--bg-tertiary);
}

.scorel-markdown blockquote {
  border-left: 3px solid var(--accent);
  margin: 8px 0;
  padding: 4px 12px;
  color: var(--text-secondary);
}

.scorel-markdown h1, .scorel-markdown h2, .scorel-markdown h3,
.scorel-markdown h4, .scorel-markdown h5, .scorel-markdown h6 {
  margin: 12px 0 6px 0;
  line-height: 1.3;
}
```

**作用范围**：

- ✅ AssistantMessage 的 TextPart → Markdown 渲染
- ✗ UserMessage → 保持纯文本（用户输入不需要 Markdown）
- ✗ ThinkingPart → 保持 italic 纯文本
- ✗ ToolResultMessage → 保持 monospace 纯文本（工具输出是原始 output）

**XSS 安全性**：`react-markdown` 默认将 HTML 标签渲染为文本（`allowedElements` 白名单机制）。`<script>alert(1)</script>` 会显示为可见文本而非执行。无需额外 sanitize。

**代码高亮（M6 不做）**：完整的代码高亮需要 `rehype-highlight` 或 `react-syntax-highlighter`（200KB+），对包体积影响大。M6 使用 `<pre><code>` 原始样式，代码高亮推迟到 V1。

### 3.3 D3: Settings 面板 — `SettingsView.tsx`

**设计决策**：

| 决策 | 选择 | 理由 |
|------|------|------|
| 展现方式 | 全页替换（替代 ChatView 区域） | 模态框空间不够；Settings 不需要和聊天同时可见 |
| 入口 | Sidebar 底部按钮 + Cmd+, | 符合 macOS 习惯 |
| 表单复用 | 复用 `setup-wizard-model.ts` 的 draft/validate/buildConfig 逻辑 | 避免重复代码 |
| API Key 展示 | 只显示 "Key stored ✓" / "No key" 状态 | write-only 安全约束 |

**页面结构**：

```
┌─────────────────────────────────────────────────┐
│  Settings                            [× Close]  │
├──────────────┬──────────────────────────────────┤
│              │                                   │
│  Providers   │  Provider Detail                  │
│  ────────    │  ────────────────                  │
│  ▸ OpenAI ✓  │  Display Name:  [OpenAI        ]  │
│    Anthropic │  Base URL:      [https://api... ]  │
│              │  Model:         [gpt-4o         ]  │
│              │  API Key:       [Key stored ✓   ]  │
│              │                 [Update Key]       │
│              │                                    │
│  [+ Add]     │  [Test Connection]  [Delete]      │
│              │                                    │
└──────────────┴──────────────────────────────────┘
```

**核心类型**：

```ts
type SettingsViewProps = {
  onClose: () => void;
};
```

**App.tsx 导航状态**：

```tsx
// App.tsx — 新增 view 状态
type AppView = "chat" | "settings";
const [appView, setAppView] = useState<AppView>("chat");

// Sidebar 底部新增 Settings 按钮
<button onClick={() => setAppView("settings")}>Settings</button>

// Main area 分流
{appView === "settings" ? (
  <SettingsView onClose={() => setAppView("chat")} />
) : activeSessionId ? (
  <ChatView ... />
) : (
  <div>Select or create a chat...</div>
)}
```

**功能列表**：

1. **查看 provider 列表**：左侧列表显示所有已配置的 provider，标注是否有 API key
2. **编辑 provider**：右侧表单编辑 displayName / baseUrl / model，调用 `providers.upsert()`
3. **更新 API Key**：点击 "Update Key" 显示密码输入框，调用 `secrets.store()`
4. **测试连接**：复用 `providers.testConnection(config, apiKey)`，但需要先获取当前 key
5. **删除 provider**：确认后调用 `providers.delete()` + `secrets.clear()`
6. **添加 provider**：打开类似 SetupWizard 的 configure 表单

**API Key 更新的特殊处理**：

当前 `testConnection` IPC 需要传入 apiKey 明文。对于"更新已有 provider 的 key"场景：
- 用户在 Settings 输入新 key → 调用 `testConnection(config, newKey)` 验证
- 验证通过 → `secrets.store(providerId, newKey)` 覆盖
- 验证失败 → 提示错误，不覆盖旧 key

对于"测试已有 key"场景（不改 key）：Settings 面板不能获取已存的 key（write-only）。解决方案：

```
选项 A: 新增 providers:testExisting IPC — main 进程内读 key + 测试
选项 B: 仅在有新 key 输入时才允许 Test — 不支持"测试当前 key"
```

**选择 A**：新增 `providers:testExisting` IPC handler，在 main 进程内部读取 Keychain 中的 key 并测试，不将 key 发送到 renderer。

```ts
// ipc-handlers.ts 新增
ipcMain.handle("providers:testExisting", async (_event, providerId: string) => {
  const config = getProviderById(db, providerId);
  if (!config) return { ok: false, error: "Provider not found" };

  const apiKey = await getSecret(providerId);
  if (!apiKey) return { ok: false, error: "No API key stored" };

  try {
    const response = await fetch(buildHealthcheckUrl(config), {
      method: "GET",
      headers: buildAuthHeaders(config, apiKey),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return { ok: false, error: `${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ""}` };
    }
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});
```

```ts
// preload 新增
providers: {
  // ...existing
  testExisting: (providerId: string) =>
    ipcRenderer.invoke("providers:testExisting", providerId),
},
```

**Cmd+, 快捷键**：

```ts
// menu.ts — File submenu 新增
{
  label: "Settings",
  accelerator: "CmdOrCtrl+,",
  click: () => mainWindow.webContents.send("menu:settings"),
},
```

```ts
// preload 新增
menu: {
  // ...existing
  onSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("menu:settings", listener);
    return () => ipcRenderer.removeListener("menu:settings", listener);
  },
},
```

### 3.4 D4: App 默认 Workspace

**方案**：

1. 应用首次启动时，检查 `~/Scorel` 是否存在
2. 不存在 → 创建 `~/Scorel` 目录
3. 将路径存入 app 配置（`app-config.json` 在 userData 目录下）
4. New Chat 默认使用此目录

**实现**：

```ts
// src/main/app-config.ts — 新建

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

type AppConfig = {
  defaultWorkspace: string;
};

const DEFAULT_WORKSPACE_NAME = "Scorel";

export function loadAppConfig(userDataPath: string): AppConfig {
  const configPath = path.join(userDataPath, "app-config.json");
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as AppConfig;
  } catch {
    // First launch — create default config
    const defaultWorkspace = path.join(os.homedir(), DEFAULT_WORKSPACE_NAME);
    const config: AppConfig = { defaultWorkspace };
    ensureDir(defaultWorkspace);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    return config;
  }
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
```

**Preload 新增**：

```ts
app: {
  // ...existing
  getDefaultWorkspace: () => ipcRenderer.invoke("app:getDefaultWorkspace"),
},
```

**IPC Handler 新增**：

```ts
ipcMain.handle("app:getDefaultWorkspace", async () => {
  return appConfig.defaultWorkspace;
});
```

### 3.5 D5: Workspace 历史

**Storage — `workspaces` 表**：

```sql
-- db.ts 新增 migration (SCHEMA_V2)
CREATE TABLE IF NOT EXISTS workspaces (
  path TEXT PRIMARY KEY,
  label TEXT,
  last_used_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
```

**Migration 策略**：当前 `CURRENT_USER_VERSION = 1`，M6 升级到 `2`。新增的 `workspaces` 表不影响已有数据。

```ts
// db.ts — migration runner 新增
if (currentVersion < 2) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      path TEXT PRIMARY KEY,
      label TEXT,
      last_used_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  db.pragma("user_version = 2");
}
```

**CRUD 函数**：

```ts
// db.ts 新增

type WorkspaceRecord = {
  path: string;
  label: string | null;
  lastUsedAt: number;
  createdAt: number;
};

function upsertWorkspace(db: Database.Database, workspacePath: string, label?: string): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO workspaces (path, label, last_used_at, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET last_used_at = ?, label = COALESCE(?, label)
  `).run(workspacePath, label ?? null, now, now, now, label ?? null);
}

function listWorkspaces(db: Database.Database, limit: number = 20): WorkspaceRecord[] {
  return db.prepare(`
    SELECT path, label, last_used_at AS lastUsedAt, created_at AS createdAt
    FROM workspaces
    ORDER BY last_used_at DESC
    LIMIT ?
  `).all(limit) as WorkspaceRecord[];
}

function deleteWorkspace(db: Database.Database, workspacePath: string): void {
  db.prepare("DELETE FROM workspaces WHERE path = ?").run(workspacePath);
}
```

**自动记录**：在 `sessions:create` IPC handler 中，session 创建成功后自动 upsert workspace：

```ts
// ipc-handlers.ts — sessions:create handler 补充
ipcMain.handle("sessions:create", async (_event, createOpts) => {
  const sessionId = sessionManager.create(createOpts.workspaceRoot, { ... });
  upsertWorkspace(db, createOpts.workspaceRoot);  // 自动记录
  return { sessionId };
});
```

**Preload 新增**：

```ts
workspaces: {
  list: (limit?: number) =>
    ipcRenderer.invoke("workspaces:list", limit),
},
```

**IPC Handler**：

```ts
ipcMain.handle("workspaces:list", async (_event, limit?: number) => {
  return listWorkspaces(db, limit);
});
```

**Renderer — New Chat 工作区选择器**：

替换 `App.tsx` 中的 `handleNewSession`：

```tsx
// 当前实现（每次弹文件夹选择器）：
const handleNewSession = async () => {
  const workspaceRoot = await window.scorel.app.selectDirectory();
  if (!workspaceRoot) return;
  // ...
};

// M6 改造（显示工作区选择器）：
const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);

const handleNewSession = () => {
  setShowWorkspacePicker(true);
};
```

**WorkspacePicker 组件**：

```
┌────────────────────────────────────────┐
│  Select Workspace                      │
│                                        │
│  📁 ~/Scorel (default)     [Use]       │
│  📁 ~/Projects/my-app      [Use]       │
│  📁 ~/code/backend         [Use]       │
│                                        │
│  [Browse...]               [Cancel]    │
└────────────────────────────────────────┘
```

显示逻辑：
1. 默认 workspace 始终在第一位
2. 历史工作区按 `lastUsedAt` 降序排列
3. 灰色显示磁盘上已不存在的路径（不可选）
4. "Browse..." 调用 `selectDirectory()` 选择新目录
5. 选择后立即创建 session

**路径存在性检测**：在 renderer 侧无法直接访问文件系统（sandbox）。需要在 main 进程做：

```ts
// ipc-handlers.ts 新增
ipcMain.handle("workspaces:list", async (_event, limit?: number) => {
  const records = listWorkspaces(db, limit);
  // 标注路径是否存在
  return records.map((r) => ({
    ...r,
    exists: fs.existsSync(r.path),
  }));
});
```

```ts
// types.ts 新增
type WorkspaceEntry = WorkspaceRecord & {
  exists: boolean;
};
```

## 4. IPC 层变更总汇

### 4.1 Preload 新增

```ts
// preload/index.ts 新增
app: {
  // ...existing (selectDirectory, getVersion, getTheme, onThemeChanged)
  getDefaultWorkspace: () => ipcRenderer.invoke("app:getDefaultWorkspace"),
},
providers: {
  // ...existing (list, upsert, delete, testConnection)
  testExisting: (providerId: string) =>
    ipcRenderer.invoke("providers:testExisting", providerId),
},
workspaces: {
  list: (limit?: number) =>
    ipcRenderer.invoke("workspaces:list", limit),
},
menu: {
  // ...existing (onNewSession)
  onSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("menu:settings", listener);
    return () => ipcRenderer.removeListener("menu:settings", listener);
  },
},
```

### 4.2 IPC Handlers 新增

```ts
// ipc-handlers.ts 新增
ipcMain.handle("app:getDefaultWorkspace", ...);
ipcMain.handle("providers:testExisting", ...);
ipcMain.handle("workspaces:list", ...);
```

### 4.3 Menu 新增

```ts
// menu.ts — File submenu 新增
{ label: "Settings", accelerator: "CmdOrCtrl+,", click: () => ... }
```

### 4.4 global.d.ts 扩展

```ts
type ScorelBridge = {
  app: {
    // ...existing
    getDefaultWorkspace(): Promise<string>;
  };
  providers: {
    // ...existing
    testExisting(providerId: string): Promise<{ ok: boolean; error?: string }>;
  };
  workspaces: {
    list(limit?: number): Promise<WorkspaceEntry[]>;
  };
  menu: {
    // ...existing
    onSettings(callback: () => void): () => void;
  };
};
```

## 5. 数据流

### 5.1 工具审批流程（修复后）

```
LLM 返回 tool_use (stopReason: toolUse)
  → Orchestrator: requiresApproval? → yes
    → emit approval.requested { toolCallId, name }
      → EventBus → IPC → Renderer
        → useChat: setChatState("awaiting_approval")
        → toolStatuses[id] = { state: "awaiting_approval" }
        → MessageList: 渲染 Approve / Deny 按钮     ← M6 新增

用户点击 Approve:
  → window.scorel.tools.approve(sessionId, toolCallId)
    → IPC → orchestrator.approveToolCall(toolCallId)
      → emit approval.resolved { decision: "approved" }
        → useChat: setChatState("tooling")
        → toolStatuses[id] = { state: "running" }
        → MessageList: 按钮消失，显示 "Running" + spinner

用户点击 Deny:
  → window.scorel.tools.deny(sessionId, toolCallId)
    → IPC → orchestrator.denyToolCall(toolCallId)
      → makeDeniedResult → persist ToolResultMessage
      → emit approval.resolved { decision: "denied" }
        → toolStatuses[id] = { state: "denied" }
```

### 5.2 Markdown 渲染流程

```
LLM stream → AssistantMessage.content = [TextPart, ToolCallPart, ...]
  → MessageList.renderContentPart()
    → part.type === "text"
      → <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
        → 解析 Markdown AST → React 虚拟 DOM
        → 代码块 → <pre><code>
        → 列表 → <ul><li>
        → 表格 → <table>
        → 链接 → <a> (新窗口打开)
    → part.type === "toolCall"
      → 保持原有 monospace 渲染 + 审批按钮
    → part.type === "thinking"
      → 保持 italic 纯文本
```

### 5.3 Settings 面板流程

```
用户点击 Sidebar Settings 按钮 / Cmd+,
  → setAppView("settings")
  → 渲染 SettingsView
    → providers.list() → 显示 provider 列表

编辑 provider:
  → 用户修改表单
  → providers.upsert(updatedConfig) → 更新 DB + providerMap
  → 成功提示

更新 API Key:
  → 用户输入新 key
  → providers.testConnection(config, newKey) → 验证
  → ok → secrets.store(providerId, newKey) → 覆盖旧 key
  → 刷新状态

测试已有连接:
  → providers.testExisting(providerId)
  → main 进程内 getSecret → fetch → 返回 { ok, error }
  → 显示结果

添加 provider:
  → 复用 SetupWizard 的 configure/test 步骤
  → providers.upsert + secrets.store
  → 刷新列表
```

### 5.4 New Chat 工作区选择流程

```
用户点击 New Chat
  → setShowWorkspacePicker(true)
  → 并行加载:
    → app.getDefaultWorkspace() → defaultPath
    → workspaces.list(20) → recentWorkspaces[]
  → 渲染 WorkspacePicker:
    → 默认工作区（第一位）
    → 历史工作区（按 lastUsedAt 降序）
    → 灰色不可选 = exists: false
    → "Browse..." = selectDirectory()

用户选择工作区 / Browse 选择新路径:
  → sessions.create({ providerId, modelId, workspaceRoot })
    → (ipc-handlers 中) upsertWorkspace(db, workspaceRoot) ← 自动记录
  → 关闭 picker
  → setActiveSessionId(sessionId)
```

## 6. 类型定义新增

### `src/shared/types.ts`

```ts
/** Workspace record from workspaces table */
export type WorkspaceRecord = {
  path: string;
  label: string | null;
  lastUsedAt: number;
  createdAt: number;
};

/** Workspace entry with existence check (returned to renderer) */
export type WorkspaceEntry = WorkspaceRecord & {
  exists: boolean;
};
```

## 7. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/renderer/components/MessageList.tsx` | 修改 | 新增 sessionId prop + Approve/Deny 按钮 + Markdown 渲染 |
| `src/renderer/components/ChatView.tsx` | 修改 | 传入 sessionId 到 MessageList |
| `src/renderer/components/SettingsView.tsx` | **新建** | Provider CRUD 面板 |
| `src/renderer/components/WorkspacePicker.tsx` | **新建** | 工作区选择器组件 |
| `src/renderer/App.tsx` | 修改 | Settings 导航 + WorkspacePicker 集成 + Cmd+, 监听 |
| `src/renderer/global.d.ts` | 修改 | ScorelBridge 扩展 |
| `src/renderer/theme.css` | 修改 | 新增 `.scorel-markdown` 排版样式 |
| `src/main/app-config.ts` | **新建** | 默认 workspace 配置 |
| `src/main/storage/db.ts` | 修改 | workspaces 表 migration + CRUD 函数 |
| `src/main/ipc-handlers.ts` | 修改 | 新增 getDefaultWorkspace / testExisting / workspaces IPC |
| `src/main/menu.ts` | 修改 | 新增 Settings 菜单项 |
| `src/preload/index.ts` | 修改 | 新增 app.getDefaultWorkspace / providers.testExisting / workspaces / menu.onSettings |
| `src/shared/types.ts` | 修改 | 新增 WorkspaceRecord / WorkspaceEntry |
| `package.json` | 修改 | 新增 react-markdown + remark-gfm 依赖 |

## 8. 测试策略

### 8.1 单元测试

| 测试文件 | 覆盖范围 | 关键用例 |
|---------|---------|---------|
| `tests/unit/workspace-db.test.ts` | workspaces CRUD | upsert 新路径；upsert 已有路径更新 lastUsedAt；list 按 lastUsedAt 降序；limit 生效；delete 工作区 |
| `tests/unit/app-config.test.ts` | loadAppConfig | 首次加载创建 config + ~/Scorel 目录；已有 config 正常读取；config JSON 损坏回退默认值 |
| `tests/unit/settings-view.test.ts` | SettingsView | provider 列表渲染；编辑表单提交；API key 更新流程；删除确认 |
| `tests/unit/markdown-render.test.ts` | Markdown 渲染 | 代码块渲染为 `<pre>`；XSS `<script>` 标签不执行；GFM 表格渲染；空内容不崩溃 |

### 8.2 集成测试

| 测试文件 | 覆盖范围 |
|---------|---------|
| `tests/integration/approval-ui.test.ts` | 完整审批流程：approval.requested → 按钮出现 → approve → tool 执行 → 结果显示 |
| `tests/integration/workspace-flow.test.ts` | 创建 session → workspace 自动记录 → 第二次 New Chat 显示历史 |

### 8.3 验收标准对照

| Spec Case | 验证方式 |
|-----------|---------|
| K: Approve → tool executes → result shown | 集成测试 + 手动验证 |
| K': Deny → error result → model adapts | 集成测试 |
| L: Markdown 渲染 | 单元测试 + 手动验证各元素 |
| M: Settings 改 API key → 生效 | 手动验证 |
| N: New Chat 使用默认 workspace | 单元测试 + 手动验证 |
| N': New Chat 选择历史 workspace | 集成测试 + 手动验证 |
| XSS 防护 | 单元测试 |
| Cmd+, 打开 Settings | 手动验证 |

## 9. 性能考量

### Markdown 渲染开销

`react-markdown` 对每个 TextPart 调用一次 Markdown 解析。对于长 assistant 消息（5000+ chars），解析时间 < 5ms（remark/unified pipeline 很快）。streaming 阶段每次 delta 更新会重新解析整个 TextPart 文本——这是 O(n) 的，但在实际场景中（streaming token 速率 ~50-100 tokens/s），渲染帧率不会成为瓶颈。

如果未来发现 streaming 长消息时卡顿：
- 方案 A: debounce Markdown 渲染（streaming 中用纯文本，结束后切换 Markdown）
- 方案 B: 只对最后一个 TextPart 做 streaming 渲染，之前的 TextParts 缓存解析结果

M6 不做优化，先验证实际体验。

### Workspace 列表查询

`listWorkspaces` 查询 + `fs.existsSync` N 次。N ≤ 20，查询 < 1ms，文件存在检测 < 5ms。无性能问题。

### Settings 面板的 Provider 列表

`providers.list()` 查询一次 SQLite。通常 1-3 个 provider。无性能问题。

## 10. 依赖新增

```json
{
  "dependencies": {
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0"
  }
}
```

`react-markdown` v9 是 ESM-only。当前项目使用 Vite + ESM 构建 renderer，兼容。

确认事项：
- `react-markdown` v9 要求 React ≥ 18。项目用 React 19 ✅
- `remark-gfm` v4 是 `react-markdown` v9 的兼容版本 ✅
- 仅 renderer 使用，不影响 main/preload 构建 ✅

## 11. DB Migration

**From V1 → V2**：

```ts
// db.ts — ensureSchema() 新增
if (currentVersion < 2) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      path TEXT PRIMARY KEY,
      label TEXT,
      last_used_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  db.pragma("user_version = 2");
}
```

**回填已有 workspaces**：Migration 时可选择从 `sessions` 表中提取已有的 `workspace_root` 路径：

```ts
// 可选回填
db.exec(`
  INSERT OR IGNORE INTO workspaces (path, label, last_used_at, created_at)
  SELECT DISTINCT workspace_root, NULL, updated_at, created_at
  FROM sessions
  WHERE workspace_root IS NOT NULL AND workspace_root != '';
`);
```

这样已有的 session workspace 会自动出现在历史列表中。

## 12. 与 Spec 的偏差

| Spec 要求 | 实际方案 | 理由 |
|-----------|---------|------|
| "Buttons render inline in the tool call card" | 直接在 `renderContentPart` toolCall case 中条件渲染 | 最简方案，与现有代码结构一致 |
| Settings "reuse SetupWizard form components" | 复用 `setup-wizard-model.ts` 逻辑（draft/validate/buildConfig），但不复用 SetupWizard 组件 | SetupWizard 是多步向导，结构与 Settings 的表单模式差异大；逻辑层复用、UI 层独立 |
| Default workspace "e.g. ~/Scorel" | 固定为 `~/Scorel` | 简单明确；用户可通过 app-config.json 手动修改 |
| "Max history: 20 entries (LRU eviction)" | SQL `LIMIT 20` + 不主动删除旧记录 | 表中可存更多，查询时限制返回；简单无状态 |
| Markdown "syntax highlighting deferred to V1" | 仅 `<pre><code>` 样式，无语法高亮 | 避免 200KB+ 依赖膨胀 |

## 13. 已知限制

1. **Markdown streaming 渲染**：streaming 中 TextPart 不断增长，`react-markdown` 每次重新解析完整文本。对极长消息（>10000 chars streaming）可能有轻微延迟。M6 不优化。
2. **代码高亮**：M6 的代码块是无高亮的 monospace 文本。语法高亮推迟到 V1。
3. **Settings 不支持多模型管理**：当前 `ProviderConfig.models` 是数组但 UI 只编辑第一个模型。多模型选择推迟到 V1。
4. **Workspace 不支持重命名/删除**：`workspaces` 表有 `label` 字段但 M6 不暴露编辑 UI。
5. **默认 workspace 路径不可在 UI 中修改**：需要手动编辑 `app-config.json`。
6. **"Reject with reason" 不在 M6**：Deny 按钮只发送拒绝，不附带理由文本。推迟到 V1 M1。
7. **测试已有连接需新增 IPC**：`providers:testExisting` 是新端点，增加了 API surface。但比暴露 `getSecret` 到 renderer 更安全。

## 14. 实施顺序建议

五个子项依赖较少，可高度并行。建议分三个阶段：

**Phase 1 — 核心修复（阻塞性最高，优先）**

1. D1: Approval 按钮
   - `MessageList.tsx` 新增 sessionId prop + 按钮
   - `ChatView.tsx` 传入 sessionId
   - 验证：手动触发 tool call → 按钮出现 → approve/deny 正常
2. D2: Markdown 渲染
   - `pnpm add react-markdown remark-gfm`
   - `MessageList.tsx` TextPart 替换为 `<ReactMarkdown>`
   - `theme.css` 新增 `.scorel-markdown` 样式
   - 验证：让 LLM 生成带代码块/列表/表格的回复

**Phase 2 — 基础设施（Phase 3 的前置）**

3. D4: 默认 Workspace
   - `app-config.ts` 新建
   - IPC handler + preload bridge
   - 验证：首次启动 → `~/Scorel` 创建
4. D5: Workspace 历史
   - DB migration V1 → V2
   - CRUD 函数 + IPC
   - `sessions:create` 自动 upsert
   - 验证：创建 session 后再 list → 历史出现

**Phase 3 — UI 集成**

5. D3: Settings 面板
   - `SettingsView.tsx` 新建
   - App.tsx 导航集成
   - `providers:testExisting` IPC
   - menu.ts Cmd+, 快捷键
6. WorkspacePicker 组件
   - 替换 `handleNewSession` 中的 `selectDirectory()` 调用
   - 集成默认 workspace + 历史列表
7. 单元测试 + 集成测试
8. 手动 dogfood 验证 Case K/L/M/N
