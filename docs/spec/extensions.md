# 扩展点：Hooks、Extensions、Prompt 与配置

> 上游：`architecture.md`
> 主题：核心做减法，变化都收拢到这一层——Hook、Extension、System Prompt 组装、TOML 配置。

---

## 1. 设计目标

Scorel 核心要保持小而稳定，所有"怎么用"的决定应当外置。这份文档覆盖的四个机制都是"向外开口"：

| 机制 | 面向 | 变化频率 |
|------|------|---------|
| Hooks | 核心 + Extension 都用 | 低，接口要稳定 |
| Extensions | 第三方 / 用户 | 高，动态加载 |
| System Prompt 组装 | 用户 + 项目 | 中 |
| 配置 | 用户 + 运维 | 高 |

四个机制都围绕 **同一条原则**：核心只定义"在哪里可以接"，不定义"接什么"。

---

## 2. Hooks 系统

Scorel 的 Hooks 分两类：**原生 Hook**（来自 pi-agent-core，串行/拦截）和 **广播 Hook**（来自 `agent.subscribe`，并行/通知）。

### 2.1 原生 Hook（4 个，可阻断/可修改）

| Hook | 能力 | 典型用途 |
|------|------|---------|
| `beforeToolCall` | 拦截 / 修改工具调用 | 参数归一化；未来的权限审批 |
| `afterToolCall` | 覆盖工具结果 | 结果修正、日志审计 |
| `transformContext` | 修改消息列表 | 压缩、rewind 解析；未来的记忆注入 |
| `convertToLlm` | 过滤消息送 LLM | 隔离应用层自定义消息 |

**组合规则**：同一个原生 hook 不允许多个 Extension 并行覆盖，必须**链式包装**——按 Extension 声明顺序串联，每层都能决定是否继续向下传。

### 2.2 广播 Hook（基于 `subscribe`）

在 pi-agent-core 的 11 种 `AgentEvent` 之上扩展 Scorel 语义事件：

```typescript
type ScorelEvent =
  | AgentEvent                           // 透传 pi-agent-core
  | { type: 'session_start'; sessionId: string }
  | { type: 'session_end'; sessionId: string; reason: string }
  | { type: 'prompt_submit'; sessionId: string; prompt: string }
  | { type: 'turn_finish'; sessionId: string; usage: Usage; duration: number }
  | { type: 'turn_error'; sessionId: string; error: Error }
  | { type: 'rewind'; sessionId: string; targetId: string }
  | { type: 'compact'; sessionId: string; tokensBefore: number; tokensAfter: number };
```

广播 Hook **并行执行、错误隔离**，单个订阅失败不影响其他。

---

## 3. Extensions 系统

### 3.1 接口

```typescript
interface Extension {
  id: string;
  name: string;
  version: string;

  activate?(ctx: ExtensionContext): Promise<void>;
  deactivate?(): Promise<void>;

  tools?(): AgentTool[];                           // 追加工具
  commands?(): Record<string, SlashCommand>;        // 追加斜杠命令
  onEvent?(event: ScorelEvent, ctx: ExtensionContext): Promise<void>;
  hooks?(): Partial<{
    beforeToolCall: BeforeToolCallHook;
    afterToolCall: AfterToolCallHook;
    transformContext: TransformContextHook;
  }>;
}

interface ExtensionContext {
  readonly agent: Agent;
  readonly session: SessionStore;
  readonly config: Config;
  readonly logger: Logger;
}
```

Extension 可以注入四种能力：工具、斜杠命令、事件监听、原生 Hook。四种都不是必选，一个扩展可以只做最小的一件事。

### 3.2 加载路径与时机

```
~/.scorel/extensions/    ← 全局
.scorel/extensions/       ← 项目级
```

启动时扫描 `.ts` / `.js`，动态 `import()`，调用 `activate()`。项目级覆盖全局。

### 3.3 错误隔离

广播事件使用 `Promise.allSettled` + 单 Extension try/catch：

```typescript
class ExtensionRunner {
  async emit(event: ScorelEvent): Promise<void> {
    await Promise.allSettled(
      this.extensions.map(async (ext) => {
        try {
          await ext.onEvent?.(event, this.ctx(ext));
        } catch (err) {
          logger.error(`Extension ${ext.id} failed on ${event.type}:`, err);
        }
      }),
    );
  }
}
```

**单个 Extension 挂掉绝不影响核心和其他 Extension。** 原生 Hook 的链式包装里同样有 try/catch 兜底，但拦截失败会直接跳过该层。

---

## 4. System Prompt 组装

System Prompt 是若干内容块按优先级和预算拼出来的：

```typescript
class PromptBuilder {
  build(ctx: { cwd: string; model: Model; tools: AgentTool[]; mcp: McpTool[] }): string {
    const parts = [
      { priority: 100, content: SCOREL_BASE_PROMPT },                            // 行为规范
      { priority:  90, content: renderContextVars(ctx) },                        // cwd / date / git
      { priority:  80, content: this.config.userPrompt },                        // 用户自定义
      { priority:  70, content: await loadProjectInstructions(ctx.cwd) },        // .scorel/instructions.md
      { priority:  60, content: renderToolDescriptions(ctx.tools) },
      { priority:  50, content: renderMcpDescriptions(ctx.mcp) },
    ];

    const budget = ctx.model.contextWindow * 0.15;
    return assembleWithBudget(parts.sort((a, b) => b.priority - a.priority), budget);
  }
}
```

**预算策略**：按优先级从高到低拼，超预算时截断低优先级（通常是 MCP 描述和部分工具描述）。

初期的行为规范模板和用户自定义格式先定死一版。如果 Extension 想插入内容，应当通过 `transformContext` 注入到首条 user message 里，**不改 System Prompt**——保持 prompt cache 友好。

---

## 5. 配置系统

### 5.1 格式与优先级

**格式**：TOML

**读取顺序**（高 → 低）：
1. `.scorel/config.toml`（项目级）
2. `~/.scorel/config.toml`（用户级）

`~/.scorel` 是固定用户级根目录；`~/.scorel/config.toml` 是固定用户级配置文件；JSONL session 默认固定写入 `~/.scorel/sessions`。这些路径是产品约定，不作为可配置字段暴露。测试和内部嵌入场景可以通过代码注入临时 session 目录，但这不是用户配置面。

环境变量不参与通用配置覆盖，只通过 `apiKeyEnv` 指向具体密钥。CLI 参数也不复制完整 config schema；只有明确属于交互控制的参数才进入 CLI。

### 5.2 初期配置示例

pi-ai 已支持的内置 provider 使用 `type = "builtin"`，Scorel 只把 provider/model/api key 交给 pi-ai，不在本仓库重写 provider 协议：

```toml
[model]
type = "builtin"
provider = "openai"
id = "gpt-5.4-mini"
apiKeyEnv = "SCOREL_API_KEY"
```

自定义兼容 endpoint 使用 `type = "custom"`，并显式声明兼容协议。这个分支和 builtin provider 分开，避免把任意自定义 endpoint 混成 pi-ai 内置 provider：

```toml
[model]
type = "custom"
api = "openai-completions"
provider = "chanleramp"
id = "gpt-5.4-mini"
baseUrl = "https://amp.chanler.dev/v1"
apiKeyEnv = "SCOREL_API_KEY"
contextWindow = 400000
maxTokens = 128000
reasoning = true
```

`api` 初期只接受以下四个值：

```text
openai-completions
openai-responses
google-generative-ai
anthropic-messages
```

工具配置和扩展配置在对应模块稳定后进入同一个 schema：

```toml
[tools]
preset = "coding"

[channels]
enabled = ["cli"]

[mcp]
[[mcp.servers]]
name = "github"
transport = "stdio"
command = "mcp-server-github"

[extensions]
disabled = ["experimental-memory"]
```

### 5.3 Schema 规则

配置必须通过 `SCOREL_CONFIG_SCHEMA` 校验。未知 section 和未知 key 都应由通用 schema 校验拒绝，例如根级 `sessionsDir = "/tmp/nope"` 必须报 `Unsupported config key: sessionsDir`，不能为单个字段写特殊判断。

当前已落地的稳定 section 只有 `[model]`。未来新增 `[tools]` / `[mcp]` / `[extensions]` 时，必须先把字段加入 schema，再接入加载逻辑和测试。

### 5.4 延后段落

- `[permissions]` — 权限策略。初期工具默认全允许，权限审批整体后补
- `[channels.telegram]` / `[channels.wechat]` — IM Channel 配置
- `[mcp.servers.*.tier]` / `keywords` — MCP 分级加载配置

这些段落的 schema 会在对应模块落地时补入，初期不预留任何半成品字段。

---

## 6. 初期范围与延后项

**初期落地**
- 4 个原生 Hook 暴露给 Extension（链式包装）
- 广播事件：`turn_finish` / `turn_error` / `rewind` / `compact`
- Extension 加载 + 错误隔离（`tools` / `commands` / `onEvent`）
- System Prompt 组装与预算
- TOML 配置的核心段：`[model]`，并通过 `SCOREL_CONFIG_SCHEMA` 统一拒绝未知 section/key

**延后**
- Extension 的沙箱与权限边界（现阶段信任本地扩展）
- Prompt 的模板化与多语种切换
- 热更新配置（初期启动时读一次即可）
- `[tools]` / `[channels]` / `[mcp]` / `[extensions]` 的完整配置 schema
- Skills 加载（`~/.scorel/skills/*/SKILL.md`）

---

*所有"用户可定制"的口子都收在这一层。核心 API 稳定后，新能力优先作为 Extension 而不是核心改动。*
