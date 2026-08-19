# 工具系统：内置工具 + MCP

> 上游：`architecture.md`
> 主题：Agent 的能力边界由工具决定。这份文档说明 Scorel 如何定义、组织、接入工具。

---

## 1. 设计目标

工具系统需要同时回答三个问题：

1. **怎么定义**——工具签名、参数、返回值如何描述给 LLM 和 runtime
2. **怎么组合**——哪些工具默认开启、哪些按需加载
3. **怎么扩展**——外部 MCP 服务器如何无缝接入

三个问题都 **复用 pi-ai + pi-agent-core 已有的抽象**，Scorel 不重新发明；但上层代码只依赖 Scorel 自己 re-export / adapter 后的类型，避免把底层包名泄漏到 app、daemon、extension。

**M2 / S0012 不做权限审批、沙箱和快照恢复**：先把 Coding Agent Alpha 跑通，让用户能在本地工作区完成真实搜索、读写、命令验证和 Todo 进度跟踪。当前安全边界来自清晰工具语义、read coverage / stale check、精确编辑失败规则、超时与输出截断，而不是恢复机制。

---

## 2. 工具定义：复用 `AgentTool` 语义

Scorel 对外暴露自己的 `AgentTool` / `Type` adapter，语义对齐 pi-ai 的 `Tool` + pi-agent-core 的 `AgentTool`：

```typescript
import { Type, type AgentTool } from '@scorel/core/tools';

const readTool: AgentTool = {
  name: 'Read',
  label: 'Read File',
  description: '读取文件内容',
  parameters: Type.Object({
    file_path: Type.String(),
    offset: Type.Optional(Type.Number()),
    limit: Type.Optional(Type.Number()),
    full: Type.Optional(Type.Boolean()),
  }),
  execute: async (toolCallId, args, signal, onUpdate) => {
    const content = await fs.readFile(args.path, 'utf-8');
    return {
      content: [{ type: 'text', text: content }],
      details: { path: args.path, size: content.length },
    };
  },
};
```

参数用 TypeBox 风格表达，底层 adapter 负责转成 provider 需要的 JSON Schema。

---

## 3. 内置工具集

M2 落地七个用户可见工具，语义参考 Claude Code 的基础 coding 工具，但按 Scorel 的 daemon/client/session 边界实现：

| 工具 | 说明 | 执行模式 | M2 关键约束 |
|------|------|---------|------------|
| `Read` | 读取文本文件，支持行范围 | parallel | 只读文件不读目录；结果带稳定行号；默认最多返回 2000 个完整行，并同时受当前模型 context window 1% 的估算 token 预算限制；`full: true` 使用 10% 预算；无 context window 时 fallback 为 200000；token 估算按带行号的返回文本计算，暂按约 3 字符/token；预算截断只按整行回退；结果带 startLine/endLine/totalLines/truncated/nextOffset/canWrite/estimatedTokens/tokenBudget；同一文件版本下读段可累积，覆盖完整文件后解锁写入 |
| `Write` | 创建新文件或完整重写文件 | sequential | 写既有文件前必须已读覆盖完整当前文件；读后文件被外部修改必须失败；模型侧结果不返回旧/新完整内容；优先用 `Edit` 修改既有文件 |
| `Edit` | 精确字符串替换 | sequential | 编辑前必须已读覆盖完整当前文件；读后文件被外部修改必须失败；`old_string` 不存在或不唯一时失败，除非显式 replace_all；模型侧结果只返回成功与替换计数 |
| `Bash` | 命令执行 | sequential | 指定 cwd；超时保护；输出截断；失败作为 tool result 返回 |
| `Glob` | 按文件名 / glob pattern 找文件 | parallel | 基于 ripgrep file discovery；返回结构化路径列表；排序稳定；支持分页 |
| `Grep` | 基于 ripgrep 的内容搜索 | parallel | 支持 glob/type/-A/-B/-C/context/-n/-i/multiline 过滤；支持 content/files/count 输出；限制结果数量，并用 max-columns 控制超长行 |
| `TodoWrite` | 完整替换 Todo List | sequential | 参数是完整 todos；返回 oldTodos/currentTodos；全 completed 时系统清空 currentTodos |

**执行模式**：只读工具 parallel、写类或有副作用的工具 sequential。底层 pi-agent-core 已有对应抽象时优先复用，Scorel 只通过 adapter 透出，不自建复杂调度。

**工具使用原则**：
- 读文件用 `Read`，不要让 `Bash` 代替 `cat` / `head` / `tail`。长文件默认截断；继续阅读用 `offset`，同一版本下读段覆盖完整文件后即可写。`full: true` 请求一次读完整文件，并使用 10% context window 预算。`Read` 不会为了满足预算截断单行；如果单行过长会失败并提示换搜索/专用工具。
- 改既有文件优先用 `Edit`，不要让 `Bash` 代替 `sed -i` / heredoc / redirect。
- `Write` 只用于创建新文件或完整重写。
- 找文件用 `Glob`，搜内容用 `Grep`；不要把常规搜索塞进 `Bash rg/find`。
- `Bash` 负责构建、测试、Git 状态、项目脚本等命令型工作。
- 多步骤 coding task 用 `TodoWrite` 记录当前计划和状态；CLI 必须能展示这些变化。

**后续扩展**：`LS`、Web、LSP、notebook、MCP 动态工具等能力在基础 coding loop 稳定后再补齐。

### 3.1 Subagent 工具（S0120）

| 工具 | 说明 | 执行模式 |
|------|------|---------|
| `Task` | 启动隔离上下文的 nested subagent，或按 `task_id` 等待/查询 | sequential / async |
| `TaskStop` | 停止后台 subagent | sequential |

语义对齐后台 Bash：

- 默认 `wait_time` 为 **120 秒**，与 Bash 共用 `DEFAULT_BACKGROUND_WAIT_SECONDS`。
- `wait_time` 控制当前工具调用等待窗口，不限制 subagent 生命周期；按 `task_id` 查询时同样支持等待。
- 超时后返回 `task_id` + `child_session_id`；完成后只返回 **最后一条 assistant message content**，不回灌 child event log。
- subagent 启动时只写入一条 user message（`prompt`），不继承 parent 对话。
- child session 写在 `{parentSessionId}/sub-agents/{childSessionId}/`，不进入 `list_sessions`。
- 嵌套深度 v1 限制为 1：child runtime 不注册 Task 工具。

---

## 4. 工具集预设

通过配置选择一组工具启用：

| 预设 | 包含 |
|------|------|
| `coding` | `Read` / `Write` / `Edit` / `Bash` / `Glob` / `Grep` / `TodoWrite` |
| `readonly` | `Read` / `Glob` / `Grep` |
| `all` | 内置 + 已连接的 MCP（M2 后） |
| `none` | 不启用任何工具 |

预设在 `config.toml` 的 `[tools]` 段声明（见 `spec/extensions.md §5`）。Extension 可以额外追加工具。

---

## 5. MCP 集成（S0122 已实现）

pi-ai 本身不内置 MCP，Scorel 自己接——TypeScript 生态的 MCP SDK 已经成熟，接入成本不高。

MCP 支持在 S0122 实现。配置、连接、工具发现/调用、错误隔离、断开和持久化全链路已打通。

### 5.1 Transport 支持

Scorel 支持三种 MCP transport：

- **stdio**：通过 `StdioClientTransport` 启动子进程，适合本地 MCP server（如 `npx -y @modelcontextprotocol/server-everything`）。Host shutdown 时终止子进程。
- **http**（推荐）：通过 `StreamableHTTPClientTransport` 连接 Streamable HTTP endpoint。这是 MCP 规范当前推荐的 transport。
- **sse**（legacy）：通过 `SSEClientTransport` 连接旧式 HTTP+SSE endpoint，保持向后兼容。

### 5.2 MCP 工具转换

每个 MCP 服务器暴露的 tool 被包装成一条 `AgentTool`：

```typescript
function mcpToAgentTool(connection: McpConnection, tool: McpToolDescriptor): AgentTool {
  return {
    name: `${connection.id}_${tool.toolName}`,
    description: tool.description ?? `MCP tool ${tool.name} from server ${connection.id}`,
    parameters: Type.Unsafe(tool.inputSchema ?? { type: "object", properties: {} }),
    execute: async (_toolCallId, args) => {
      return connection.callTool(tool.toolName, args);
    },
  };
}
```

MCP 生态里很多 server 用 Zod / 原生 JSON Schema，Scorel 工具签名统一在 TypeBox 风格 schema。JSON Schema 到 TypeBox 的转换由 adapter 层负责（`Type.Unsafe`）。

### 5.3 配置

MCP server 配置存储在 `~/.scorel/config.toml` 的 `[mcp.servers.<id>]` section 中，与其他 Scorel 配置共用同一配置源：

```toml
[mcp.servers.myserver]
transport = "stdio"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-everything"]

[mcp.servers.myserver.env]
NODE_ENV = "production"

[mcp.servers.myhttp]
transport = "http"
url = "https://example.com/mcp"

[mcp.servers.myhttp.envHeaders]
Authorization = "MCP_AUTH_TOKEN"
```

**凭据安全**：`envHeaders` 存储的是环境变量名而非实际值。连接时从 `process.env` 读取实际值注入 HTTP headers。配置文件中不存储 token / API key。

所有配置的 MCP 服务器在 Host 启动时连接并加载工具描述，注册到每个 session lane 的 runtime tool loop 中。配置变更时通过 `refreshMcpServers()` 重连。

### 5.4 生命周期与错误隔离

- **启动**：Host `start()` 调用 `McpManager.startServers()`，逐个连接配置的 MCP server。
- **错误隔离**：单个 MCP server 连接失败不会阻止其他 server 连接或 Host 启动。失败的 server 在状态中记录 error，但不抛异常。
- **工具注册**：连接成功后，发现的工具通过 `mcpToAgentTool()` 转换为 `AgentTool` 并注册到 runtime。
- **断开**：Host `shutdown()` 调用 `McpManager.disconnectAll()`，终止 stdio 子进程并关闭 HTTP/SSE 连接。
- **配置刷新**：CLI / GUI 通过 wire request 修改配置后，`refreshMcpServers()` 重新加载配置、停止已移除的 server、启动新 server，并重新注册工具。

### 5.5 CLI 管理

```bash
scorel mcp list                              # 列出已配置的 MCP server 及状态
scorel mcp add <id> --transport stdio \
  --command npx --args "-y,@modelcontextprotocol/server-everything"
scorel mcp add <id> --transport http --url https://example.com/mcp
scorel mcp remove <id>                       # 移除 MCP server
scorel mcp call <server> <tool> [json-args]  # 直接调用 MCP 工具
scorel mcp cloud list                        # 浏览 Cloud MCP registry
scorel mcp cloud add <catalog-id> [server-id]  # 从 registry 添加 server
```

### 5.6 GUI 设置

GUI Settings 中有 MCP 管理界面（"MCP" tab），支持：
- 查看已配置 server 列表及连接状态、工具列表和错误信息
- 添加 / 移除 MCP server（stdio / http / sse）
- 浏览 Cloud MCP registry 并一键添加

### 5.7 后续：按需分级加载

初期不做的：按 keyword 触发的 **Tier 2** 动态加载（`transformContext` 拦截用户消息，命中关键词才 attach 对应工具）。

延后的理由：
- 初期 MCP 服务器数量可控，工具描述全加载也不会撑爆 system prompt
- 分级策略依赖真实使用数据调参，在没有数据前先简单做

---

## 6. 错误是数据

工具执行失败时 **不抛异常**，而是返回包含错误信息的 `content`。pi-agent-core 会把错误编码成 `ToolResultMessage.isError` / `AssistantMessage.stopReason`，LLM 下一轮可以读取并决定是否重试。

这条原则和 `architecture.md §6` 的"错误是数据，不是异常"对齐——异常通道只保留给真正的编程错误（例如参数类型不对），业务失败都走数据通道。

---

## 7. 初期范围与延后项

**初期落地**
- M2/S0012 内置工具集：`Read` / `Write` / `Edit` / `Bash` / `Glob` / `Grep` / `TodoWrite`
- 工具集预设：`coding` / `readonly` / `all` / `none`

**延后**
- `LS` 等便利只读工具
- WebFetch / WebSearch、LSP、notebook editing、worktree mode
- **权限审批（PermissionPolicy）**：默认全允许，后期补黑名单 / 询问 / 拒绝规则
- MCP 启动时加载
- MCP Tier 2 按需加载
- 自定义 agent 定义库、更深嵌套 subagent、worktree 隔离

---

*工具系统的复杂度主要在"组合与扩展"，定义层复用 pi 栈语义，但通过 Scorel adapter 固化边界。*
