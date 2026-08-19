# S0123: Long-Running Task Supervision

## 目标

为 Scorel 提供通用的长任务监督机制：让用户能看见并控制长任务的 token、cost、wall-clock 预算，并在重复命令、连续相同验证失败或长期无有效进展时触发通用的状态总结与策略重评估。

## 范围

- 在 `@scorel/core` 中新增 task supervision 模块，从 session JSONL 事件流派生监督状态（replay-safe）。
- 在 `@scorel/core` config 中新增 `[taskBudget]` section，支持 `maxTokens`、`maxCostUsd`、`maxWallClockMinutes`、`repeatedCommandThreshold`、`staleProgressMinutes`。
- 在 `@scorel/protocol` 中新增 `TaskBudgetSettings` 和 `UpsertTaskBudgetSettingsInput` 类型，以及 `get_task_budget_settings` / `upsert_task_budget_settings` wire 请求。
- 在 `@scorel/daemon` 的 runtime loop 中，在 `tool_execution_end` 和 `message_end` 后检查预算和进展，在违规时通过 `harness_item kind="runtime_notice"` 注入状态总结与策略重评估提醒。
- 在 `@scorel/client` 中暴露 `getTaskBudgetSettings` / `upsertTaskBudgetSettings`。
- 在 `scorel run` summary 中包含 task budget 状态，并在 CLI 与 GUI Settings 中暴露预算控制。
- 补充测试覆盖 budget 阈值检测、重复命令检测、进展停滞检测和提醒生成。

## 不做什么

- 不做隐式终止或强制取消：监督提醒是 advisory，不调用 `runtime.cancel()`。
- 不针对 Terminal-Bench 任务名或 verifier 做特化：所有检测逻辑基于通用事件信号（tool name + args hash + error flag + timestamp）。
- 不破坏后台服务存活：background bash 和 subagent 的 supervision 检查只在各自 lane 的事件处理中进行。
- 不引入新的持久化存储：监督状态从 JSONL 事件流实时派生，不写入额外文件。
- 不改变 session replay 或 recover 语义：监督状态是 derived view，不修改 `buildContext()` 或 `loadSession()`。

## 验收标准

- `config.toml` 中 `[taskBudget]` section 可配置，`SCOREL_CONFIG_SCHEMA` 拒绝未知 key。
- `get_task_budget_settings` / `upsert_task_budget_settings` 通过 wire protocol 可用。
- 当 session 累计 token 超过 `maxTokens` 时，注入 `runtime_notice` 提醒。
- 当 session 累计 cost 超过 `maxCostUsd` 时，注入 `runtime_notice` 提醒。
- 当 session wall-clock 超过 `maxWallClockMinutes` 时，注入 `runtime_notice` 提醒。
- 当连续 N 次执行相同 Bash 命令（`repeatedCommandThreshold`）时，注入 `runtime_notice` 提醒。
- 当连续 N 次工具调用返回 error 且无中间成功时（同样使用 `repeatedCommandThreshold`），注入 `runtime_notice` 提醒。
- 当超过 `staleProgressMinutes` 分钟没有新的 assistant text、tool call 或成功的 tool result 时，注入 `runtime_notice` 提醒。
- 每种提醒在一个 user turn 中最多注入一次（去重），新用户消息重置去重集合，避免 spam。
- `scorel run` summary 包含 task budget usage 字段（`taskBudget.config`、`taskBudget.violations`、`taskBudget.tokensUsed`、`taskBudget.elapsedMinutes`）。
- `scorel budget [show]` 和 `scorel budget set --<field> <value>` CLI 命令可用于查看和修改预算设置。
- GUI Settings 的“任务预算”页可在本地或已连接 relay 设备上查看和修改同一组设置。
- `pnpm typecheck && pnpm test` 通过。

## 测试要求

- `task-supervision.test.ts`：单元测试覆盖 `deriveTaskSupervisionFromEvents`、`updateSupervisionState`、`checkSupervision`、`buildSupervisionReminder`、`resetSupervisionForNewTurn`。
- 测试使用纯事件序列，不依赖真实 LLM provider。
- config 测试覆盖 `[taskBudget]` section 解析和渲染。

## 影响文件 / 包

- `packages/protocol/src/events.ts` — 新增 `TaskBudgetSettings`、`UpsertTaskBudgetSettingsInput`
- `packages/protocol/src/wire.ts` — 新增 `get_task_budget_settings` / `upsert_task_budget_settings`
- `packages/core/src/config/index.ts` — 新增 `TaskBudgetConfig`、`loadTaskBudget`、`renderTaskBudgetConfig`
- `packages/core/src/task-supervision/index.ts` — 新模块
- `packages/core/src/task-supervision/task-supervision.test.ts` — 新测试
- `packages/core/src/index.ts` — 导出 task-supervision
- `packages/daemon/src/index.ts` — 集成 supervision 到 runtime loop + settings handlers
- `packages/client/src/index.ts` — 新增 client methods
- `apps/cli/src/index.ts` — `scorel budget` CLI 命令 + run summary 包含 budget usage
- `apps/gui/src/renderer/settings/sections/BudgetSection.tsx` — GUI 预算控制
- `docs/spec/ship/S0123-long-running-task-supervision.md` — 本 spec
- `docs/ROADMAP.md` — 更新 Active Specs

## 风险与边界

- **提醒 spam**：通过 per-session per-violation-type 去重避免。一旦某种违规被提醒，不会重复提醒同一类型，除非 user 发送新消息重置计数器。
- **性能**：监督状态从事件流派生，但只在 runtime loop 的事件处理点增量更新，不每轮全量扫描。
- **replay 一致性**：监督状态不写入 JSONL，只用于运行时 advisory。resume 后的状态从 JSONL 重新派生。
- **不破坏现有流程**：监督检查在 `#handleRuntimeEvent` 之后执行，不改变 event persist 顺序。
