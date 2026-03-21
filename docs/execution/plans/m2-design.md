# M2 Tool Execution — 设计与实现文档

> 状态：已实现 | 基于 V0-M2 spec | 106 tests passing

## 1. 架构总览

M2 在 M1/M1.5 的 streaming 基础上，补全了 **tool execution loop**：

```
User prompt
  → Orchestrator.send()
    → modelLoop (while true)
      → stream (LLM call, with tool definitions)
      → if stopReason === "toolUse"
        → extractToolCalls
        → for each toolCall (sequential):
            → requiresApproval? → awaiting_approval → approve/deny
            → execute via ToolRunner → ToolResult
            → persist ToolResultMessage
        → loop back to stream (with tool results in context)
      → else: persist final assistant, break
```

核心改造点：`Orchestrator.send()` 从单次 stream 变为 `modelLoop` 循环。

## 2. 模块拆分

### 2.1 Runner 进程 (`runner/`)

独立子进程，通过 stdio JSONL 与 Core 通信。与 Electron main process 完全隔离。

```
runner/
  types.ts          # RunnerCommand, RunnerEvent, ToolHandler 类型
  index.ts          # 入口：stdin readline → command dispatch → stdout JSONL
  tsconfig.json     # 独立编译配置 (outDir: dist/runner)
  tools/
    bash.ts         # shell 执行 + 截断
    read-file.ts    # 文件读取 + 二进制检测 + 行范围
    write-file.ts   # 文件写入 + mkdir -p
    edit-file.ts    # 精确匹配替换 + 唯一性校验
```

**协议设计**：

| 方向 | 消息类型 | 说明 |
|------|---------|------|
| Core → Runner | `tool.exec` | 执行工具，含 requestId/toolCallId/tool/args |
| Core → Runner | `abort` | 中止指定 toolCallId |
| Core → Runner | `ping` | 健康检查 |
| Runner → Core | `tool_execution_start` | 工具开始执行 |
| Runner → Core | `tool_execution_update` | 部分输出（预留） |
| Runner → Core | `tool_execution_end` | 执行完成，含 ToolResult |
| Runner → Core | `heartbeat` | 心跳（每 2s + 启动时立即发送） |

**Runner 生命周期**：
- 启动参数：`node dist/runner/index.js <workspaceRoot>`
- 启动后立即发送 heartbeat 表示就绪
- 每 2s 发送 heartbeat
- stdin 关闭时退出
- 不主动超时，只响应 Core 的 abort 命令

### 2.2 RunnerManager (`src/main/runner/runner-manager.ts`)

Core 侧的 Runner 进程管理器，实现 `ToolRunner` 接口：

```ts
type ToolRunner = {
  execute(toolCallId, toolName, args, opts?) → Promise<ToolResult>
  abort(toolCallId) → Promise<void>
  start() → Promise<void>
  stop() → Promise<void>
}
```

**关键机制**：

| 机制 | 实现 |
|------|------|
| 进程启动 | `spawn("node", [runnerPath, workspaceRoot])`, stdio pipe |
| 就绪检测 | 等待首个 heartbeat（5s 超时） |
| 心跳监控 | 每 2s 检查，3x 间隔无心跳 → 判定死亡 |
| Core-owned timeout | execute() 启动定时器 → 超时发 abort → 等 5s grace → kill + restart |
| 崩溃恢复 | child exit 事件 → reject 所有 pending → emit crash → auto-restart |
| 优雅停止 | stdin.end() + SIGTERM → 5s 后 SIGKILL |

**Pending 执行追踪**：
```ts
type PendingExecution = {
  toolCallId: string;
  resolve: (result: ToolResult) => void;
  timeoutTimer: ReturnType<typeof setTimeout>;
  graceTimer?: ReturnType<typeof setTimeout>;
  onUpdate?: (partial: string) => void;
  aborted: boolean;
};
```

每个 execute() 调用创建一个 PendingExecution，收到 `tool_execution_end` 时 resolve。

### 2.3 MockRunner (`src/main/runner/mock-runner.ts`)

测试用 ToolRunner 实现：
- 接受预设 `Map<toolCallId, ToolResult>` 响应
- 记录 `callHistory` 供断言
- 无真实子进程，1ms 延迟模拟异步

### 2.4 Tool Dispatch (`src/main/core/tool-dispatch.ts`)

工具注册表 + 审批路由：

```ts
TOOL_REGISTRY: Map<string, ToolEntry>
  bash       → approval: "confirm", timeout: 30s
  read_file  → approval: "allow",   timeout: 10s
  write_file → approval: "confirm", timeout: 10s
  edit_file  → approval: "confirm", timeout: 10s
```

导出函数：
- `getToolDefinitions()` → 转换为 provider 的 `ToolDefinition[]` 格式
- `requiresApproval(toolCall)` → 是否需要用户确认
- `getToolTimeout(toolCall)` → 获取超时（bash 支持 args.timeout_ms 自定义，上限 300s）
- `makeDeniedResult(toolCall)` → 生成拒绝结果

### 2.5 Orchestrator 改造 (`src/main/core/orchestrator.ts`)

**新增依赖**：`ToolRunner`（可选，不传则不进入 tool loop）

**新增方法**：
- `approveToolCall(toolCallId)` — 批准工具调用
- `denyToolCall(toolCallId)` — 拒绝工具调用

**核心流程 — `modelLoop()`**：

```
while (true):
  1. setState("streaming")
  2. adapter.stream() → assistantMessage
  3. if aborted → persist if visible output → return
  4. persist assistantMessage
  5. if stopReason !== "toolUse" → setState("idle") → return
  6. extractToolCalls from content
  7. executeToolCalls (sequential):
     for each toolCall:
       a. requiresApproval? → setState("awaiting_approval") → waitForApproval()
       b. approved → setState("tooling") → toolRunner.execute()
       c. denied → makeDeniedResult()
       d. persist ToolResultMessage
  8. loop back to step 1
```

**错误恢复**：`send()` 包裹 try/catch，异常时清理 AbortController + 重置 idle。

**Abort 行为**：
- streaming 阶段：abort AbortController
- awaiting_approval 阶段：自动 deny pending approval

### 2.6 Preload 扩展 (`src/preload/index.ts`)

新增 IPC bridge：
```ts
tools: {
  approve: (sessionId, toolCallId) → ipcRenderer.invoke("tools:approve", ...)
  deny:    (sessionId, toolCallId) → ipcRenderer.invoke("tools:deny", ...)
}
```

## 3. 工具实现细节

### 3.1 路径安全

所有文件工具共享路径校验逻辑：
```ts
const resolved = path.resolve(workspaceRoot, userPath);
if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
  → isError: true, "Path escapes workspace root: {path}"
}
```

### 3.2 bash

- `child_process.spawn(command, { shell: true, cwd: workspaceRoot })`
- stdout + stderr 合并捕获
- 截断策略：> 32000 chars → 前 8000 + 后 8000 + `...[truncated N chars]...`
- 非零退出码：`isError: false`（信息性），`details.exitCode` 记录
- abort：SIGTERM → 2s 后 SIGKILL

### 3.3 read_file

- 支持 `offset`（行偏移，0-based）+ `limit`（行数）
- 二进制检测：读前 8192 字节，含 null byte → 拒绝
- 截断：> 64000 chars → 按行截断 + `...[truncated, showing first N lines]`

### 3.4 write_file

- `mkdir -p` 自动创建父目录
- 返回简短状态消息：`Successfully wrote N bytes to {path}`

### 3.5 edit_file

- 精确字符串匹配（非正则）
- 0 匹配 → error
- 多匹配 → error（含数量）
- 1 匹配 → 替换 + 写回
- 返回 unified diff 片段（上限 2000 chars）

## 4. 事件流

一次完整 tool round 的事件序列：

```
user.prompt          → 用户发送消息
llm.request          → 开始 LLM 调用
llm.stream (N)       → 流式 token
llm.done             → assistant message (stopReason: toolUse)
approval.requested   → 需要用户确认 (bash/write/edit)
approval.resolved    → 用户批准/拒绝
tool.exec.start      → 工具开始执行
tool.exec.update (N) → 部分输出
tool.exec.end        → 工具执行完成
llm.request          → 第二轮 LLM 调用（含 tool results）
llm.stream (N)       → 流式 token
llm.done             → final assistant message (stopReason: stop)
```

## 5. 测试覆盖

| 测试文件 | 覆盖范围 | 用例数 |
|---------|---------|--------|
| `tool-dispatch.test.ts` | 注册表、审批策略、超时、denied result | 6 |
| `tool-execution.test.ts` | 完整 tool round、审批流、deny、partial deny、MockRunner | 6 |
| `runner-tools.test.ts` | 4 个工具的正常/异常路径、路径逃逸、截断、二进制检测 | 16 |
| `orchestrator.test.ts` | M1 回归（streaming、abort、错误恢复） | 12 |

关键验收场景：
- **Case B**: tool_calls → approve → execute → re-request → final text ✅
- **Case J**: deny → error ToolResultMessage → model adapts ✅
- **Partial deny**: 3 tool calls, deny #2, #1/#3 仍执行 ✅
- **No toolRunner**: 不传 toolRunner 时 tool call 不触发执行循环 ✅

## 6. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `runner/types.ts` | 新建 | Runner 协议类型 |
| `runner/index.ts` | 新建 | Runner 入口 |
| `runner/tsconfig.json` | 新建 | Runner 编译配置 |
| `runner/tools/bash.ts` | 新建 | bash 工具 |
| `runner/tools/read-file.ts` | 新建 | read_file 工具 |
| `runner/tools/write-file.ts` | 新建 | write_file 工具 |
| `runner/tools/edit-file.ts` | 新建 | edit_file 工具 |
| `src/main/runner/runner-protocol.ts` | 新建 | Core 侧协议类型 + ToolRunner 接口 |
| `src/main/runner/runner-manager.ts` | 新建 | Runner 进程管理 |
| `src/main/runner/mock-runner.ts` | 新建 | 测试用 MockRunner |
| `src/main/core/tool-dispatch.ts` | 新建 | 工具注册表 + 审批路由 |
| `src/main/core/orchestrator.ts` | 重写 | modelLoop + approval 状态机 |
| `src/preload/index.ts` | 修改 | 新增 tools.approve/deny |
| `tests/unit/tool-dispatch.test.ts` | 新建 | 6 tests |
| `tests/unit/tool-execution.test.ts` | 新建 | 6 tests |
| `tests/unit/runner-tools.test.ts` | 新建 | 16 tests |

## 7. 已知限制

- **路径 symlink**：`path.resolve` 不解析 symlink，理论上可通过 symlink 逃逸 workspace。V0 记录为已知限制。
- **并行执行**：V0 所有 tool calls 顺序执行，并行执行留待 V1+。
- **load_skill**：注册表预留了 ToolName 类型，实现推迟到 M4。
- **Runner 单实例**：当前每个 session 假设共享一个 Runner 进程，多 session 并发场景需要 M3+ 处理。
- **Abort during tooling**：当前 abort 在 streaming 阶段生效；tooling 阶段的 abort 需要通过 RunnerManager.abort() 传递，orchestrator 层尚未完整串联（需在 executeToolCalls 循环中检查 abort 信号）。

## 8. 与 Spec 的偏差

| Spec 要求 | 实际实现 | 原因 |
|-----------|---------|------|
| `ToolEntry.handler` 字段 | 不含 handler，handler 在 Runner 侧 | Core 侧 ToolEntry 只做 metadata（schema/approval/timeout），执行委托给 ToolRunner |
| `tool_execution_update` 事件 | Runner 预留了发送能力，但 4 个工具未实际发送 | V0 工具执行较快，streaming partial output 留待 V1+ |
| Case D (abort mid-tool) | Orchestrator.abort() deny pending approval，但 tooling 阶段的 abort 路径未完整测试 | 需补充集成测试 |
