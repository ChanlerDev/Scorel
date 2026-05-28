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

**M2 之后再扩展**：`LS`、Web、LSP、notebook、subagent、MCP 动态工具等能力在基础 coding loop 稳定后再补齐。

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

## 5. MCP 集成（M2 后）

pi-ai 本身不内置 MCP，Scorel 自己接——TypeScript 生态的 MCP SDK 已经成熟，接入成本不高。

MCP 不属于 M2。M2 先把内置 coding 工具和 session/daemon/client/CLI 主链路跑通；MCP 在后续 ecosystem 阶段接入。

### 5.1 MCP 工具转换

每个 MCP 服务器暴露的 tool 被包装成一条 `AgentTool`：

```typescript
function mcpToAgentTool(client: McpClient, tool: McpTool): AgentTool {
  return {
    name: `${client.name}_${tool.name}`,
    label: tool.name,
    description: tool.description,
    parameters: convertJsonSchemaToTypeBox(tool.inputSchema),
    execute: async (_, args) => {
      const result = await client.callTool(tool.name, args);
      return {
        content: result.content,
        details: { server: client.name, tool: tool.name },
      };
    },
  };
}
```

MCP 生态里很多 server 用 Zod / 原生 JSON Schema，Scorel 工具签名统一在 TypeBox 风格 schema。JSON Schema 到 TypeBox 的转换由 adapter 层负责。

### 5.2 后续：启动时加载

```typescript
interface McpServerConfig {
  name: string;
  transport: 'sse' | 'stdio';
  url?: string;            // sse
  command?: string;        // stdio
}
```

所有配置的 MCP 服务器在 session 启动时连接并加载工具描述，全部作为 `all` 预设的一部分。是否进入 `coding` 预设，需要等内置 M2 工具稳定后再决定。

### 5.3 更后续：按需分级加载

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
- Subagent 工具（工具内 `new Agent()` 递归调用，隔离上下文）

---

*工具系统的复杂度主要在"组合与扩展"，定义层复用 pi 栈语义，但通过 Scorel adapter 固化边界。*
