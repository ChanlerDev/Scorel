# d003 — 工具系统：内置工具 + MCP

> 上游：`d000-architecture.md`
> 主题：Agent 的能力边界由工具决定。这份文档说明 Scorel 如何定义、组织、接入工具。

---

## 1. 设计目标

工具系统需要同时回答三个问题：

1. **怎么定义**——工具签名、参数、返回值如何描述给 LLM 和 runtime
2. **怎么组合**——哪些工具默认开启、哪些按需加载
3. **怎么扩展**——外部 MCP 服务器如何无缝接入

三个问题都 **直接复用 pi-ai + pi-agent-core 已有的抽象**，Scorel 不重新发明。

**初期不做权限审批**：所有工具默认允许执行，用户靠自己的判断和 File Checkpoint（`d001 §7`）的可回滚性兜底。权限策略作为后期能力再补。

---

## 2. 工具定义：复用 `AgentTool`

直接使用 pi-ai 的 `Tool` + pi-agent-core 的 `AgentTool`：

```typescript
import { Type } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';

const readTool: AgentTool = {
  name: 'read',
  label: 'Read File',
  description: '读取文件内容',
  parameters: Type.Object({
    path: Type.String(),
    offset: Type.Optional(Type.Number()),
    limit: Type.Optional(Type.Number()),
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

参数用 TypeBox 表达，pi-ai 会自动转成 JSON Schema 给 LLM。

---

## 3. 内置工具集

| 工具 | 说明 | 执行模式 | 触发 File Checkpoint |
|------|------|---------|---------------------|
| `bash` | 命令执行，超时保护 | sequential | — |
| `read` | 文件读取，支持行范围 | parallel | — |
| `write` | 文件写入 | sequential | ✅ |
| `edit` | 精确字符串替换 | sequential | ✅ |
| `grep` | ripgrep 封装 | parallel | — |
| `glob` | fast-glob 封装 | parallel | — |
| `ls` | 目录列表 | parallel | — |

**执行模式**：只读工具 parallel、写类或有副作用的工具 sequential。pi-agent-core 的 `toolExecution` 字段原生支持，Scorel 不自建调度。

**File Checkpoint 接入点**：`write` / `edit` 以及任何写类自定义工具，执行前由 `beforeToolCall` hook 统一做快照。详见 `d001 §7`。

---

## 4. 工具集预设

通过配置选择一组工具启用：

| 预设 | 包含 |
|------|------|
| `coding` | 全部内置 |
| `readonly` | `read` / `grep` / `glob` / `ls` |
| `all` | 内置 + 已连接的 MCP |
| `none` | 不启用任何工具 |

预设在 `config.toml` 的 `[tools]` 段声明（见 `d004 §5`）。Extension 可以额外追加工具。

---

## 5. MCP 集成

pi-ai 本身不内置 MCP，Scorel 自己接——TypeScript 生态的 MCP SDK 已经成熟，接入成本不高。

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

MCP 生态里很多 server 用 Zod / 原生 JSON Schema，Scorel 工具签名统一在 TypeBox。`convertJsonSchemaToTypeBox`（pi-ai 已提供）负责这一层转换。

### 5.2 初期：启动时加载

```typescript
interface McpServerConfig {
  name: string;
  transport: 'sse' | 'stdio';
  url?: string;            // sse
  command?: string;        // stdio
}
```

所有配置的 MCP 服务器在 session 启动时连接并加载工具描述，全部作为 `coding` / `all` 预设的一部分。

### 5.3 延后：按需分级加载

初期不做的：按 keyword 触发的 **Tier 2** 动态加载（`transformContext` 拦截用户消息，命中关键词才 attach 对应工具）。

延后的理由：
- 初期 MCP 服务器数量可控，工具描述全加载也不会撑爆 system prompt
- 分级策略依赖真实使用数据调参，在没有数据前先简单做

---

## 6. 错误是数据

工具执行失败时 **不抛异常**，而是返回包含错误信息的 `content`。pi-agent-core 会把错误编码成 `ToolResultMessage.isError` / `AssistantMessage.stopReason`，LLM 下一轮可以读取并决定是否重试。

这条原则和 `d000 §6` 的"错误是数据，不是异常"对齐——异常通道只保留给真正的编程错误（例如参数类型不对），业务失败都走数据通道。

---

## 7. 初期范围与延后项

**初期落地**
- 内置工具集（7 个）
- 工具集预设：`coding` / `readonly` / `all` / `none`
- MCP 启动时加载
- `write` / `edit` 触发 File Checkpoint

**延后**
- **权限审批（PermissionPolicy）**：默认全允许，后期补黑名单 / 询问 / 拒绝规则
- MCP Tier 2 按需加载
- Subagent 工具（工具内 `new Agent()` 递归调用，隔离上下文）

---

*工具系统的复杂度主要在"组合与扩展"，定义层完全复用 pi-agent-core。Scorel 在这层做减法。*
