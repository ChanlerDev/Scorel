# Scorel Roadmap

> Roadmap 只定义产品阶段目标，不提前展开未来实现细节。进入某个阶段前，再把该阶段拆成具体 `S####` spec。

---

## Product Direction

Scorel 是一个 **可回放、可恢复、可远程控制的 AI Agent 工作台**。

推进顺序：

```text
Design Baseline → CLI Alpha → Safe Coding CLI → Local Daemon → Remote Control → WebUI → GUI → Ecosystem
```

---

## M0: Design Baseline

**Goal**: 固化从 0 重写所需的架构、包边界、交付协议和近期实现入口。

**Done when**:

- `docs/architecture.md` 描述最终分层和包边界。
- `docs/spec/*.md` 描述核心抽象规约。
- `docs/spec/ship/*.md` 描述当前 active S specs。
- `docs/SHIP.md` 描述 AI 开发与交付协议。
- 第一批可执行 spec 足够启动实现。

**Status**: Done

---

## M1: CLI Alpha

**Goal**: 用户可以在本地运行 `scorel chat`，通过 daemon/client 主链路完成最小多轮 agent loop，并持久化、恢复 session。

**Done when**:

- CLI 通过 daemon/client 抽象运行，而不是直接持有 runtime。
- 一轮 LLM + tool loop 可完成。
- JSONL session 可恢复。
- 基础测试和 typecheck 通过。

**Steps**:

| Step | Spec | Goal | Status |
|---|---|---|---|
| M1.1 | [`S0002`](spec/ship/S0002-package-skeleton.md) | 建立最终 workspace 和包边界，让后续代码有正确落点。 | Done |
| M1.2 | [`S0003`](spec/ship/S0003-protocol-contracts.md) | 锁定 M1 所需跨包协议，让 core/daemon/client/CLI 不重复定义契约。 | Done |
| M1.3 | [`S0004`](spec/ship/S0004-session-core.md) | 实现 append-only JSONL session 和 context replay，让对话成为可恢复资产。 | Done |
| M1.4 | [`S0005`](spec/ship/S0005-runtime-loop.md) | 实现最小 runtime loop，让给定 context 能产生可测试的 assistant event stream。 | Done |
| M1.5 | [`S0006`](spec/ship/S0006-embedded-daemon-client.md) | 用 embedded daemon + DaemonClient 串起 session、runtime 和事件流。 | Done |
| M1.6 | [`S0007`](spec/ship/S0007-cli-alpha.md) | 暴露 `scorel chat`，验证用户可见的本地多轮对话体验。 | Done |

**Not in M1**:

- Local socket / WebSocket daemon.
- Remote control, auth, reconnect after process boundary.
- Rewind UX, compact UX, permission policy.
- WebUI / GUI / channels / MCP tiered loading.

**Status**: Done

---

## M2: Safe Coding CLI

**Goal**: 用户可以让 `scorel chat` 在真实工作区内完成小到中等 coding task：理解文件、搜索代码、编辑文件、运行验证、记录 Todo 进度，并在 CLI 中看见工具调用和任务状态变化。

**Done when**:

- 内置 `Read` / `Write` / `Edit` / `Bash` / `Glob` / `Grep` / `Todo` 工具可通过 runtime loop 调用。
- `Read` 支持大文件的行范围读取，并返回稳定的行号格式。
- `Write` 写入新文件或完整重写文件；修改既有文件前必须先读，读后文件被外部修改必须失败。
- `Edit` 基于精确字符串替换；未读文件、读后文件被外部修改、匹配不到、匹配不唯一都必须失败。
- `Bash` 在指定工作目录执行命令，具备超时、输出截断和错误结果返回。
- `Glob` / `Grep` 提供结构化代码发现能力，避免模型把搜索全部塞进 shell 文本输出。
- `Todo` 提供普通 Todo List：任务创建、状态更新、删除；CLI 可见地展示 Todo 列表和状态变化。
- 工具调用、工具结果、Todo 状态和错误都能通过 daemon/client 事件流传给 CLI，并写入 session JSONL。
- `scorel chat` 使用 pi-ai 接入真实 LLM；pi-ai 内置 provider 和自定义兼容 endpoint 在 config 中分成两条明确路径。
- Config 通过 `SCOREL_CONFIG_SCHEMA` 统一拒绝未知 section/key；固定产品路径如 `~/.scorel` 和 `~/.scorel/sessions` 不暴露成用户配置项。
- `scorel chat` 可以在临时真实仓库中完成一次小型代码修改并运行验证命令。
- 基础测试和 typecheck 通过。

**Not in M2**:

- Rewind / compact / cancel / steer / followUp UX.
- Permission approval policy, sandbox, checkpoint/snapshot restore, remote daemon, MCP, GUI.
- WebFetch / WebSearch, LSP, notebook editing, worktree mode, subagent/team orchestration.

**Steps**:

| Step | Spec | Goal | Status |
|---|---|---|---|
| M2.1 | [`S0008`](spec/ship/S0008-coding-tools.md) | 暴露 `Read` / `Write` / `Edit` / `Bash`，打通文件读写和命令执行主链路。 | Done |
| M2.2 | [`S0009`](spec/ship/S0009-code-discovery-tools.md) | 暴露 `Glob` / `Grep`，让代码发现成为结构化工具结果。 | Done |
| M2.3 | [`S0010`](spec/ship/S0010-todo-tool-and-cli.md) | 暴露普通 Todo List，并在 CLI 中展示 Todo 列表和状态变化。 | Done |
| M2.4 | [`S0011`](spec/ship/S0011-coding-agent-alpha-smoke.md) | 端到端验证一次真实仓库 coding task：搜索、读取、编辑、测试、Todo 进度和恢复。 | Done |

**Status**: Done

---

## M2.5: Coding Tools Maturity

**Goal**: 让 M2 工具契约更接近成熟 coding agent：read coverage 写锁、ripgrep-backed search、`TodoWrite` 完整列表语义，以及更稳定的 tool result。

**Done when**:

- `Todo` 替换为 `TodoWrite`，参数为完整 Todo List。
- `TodoWrite` 返回旧列表和当前列表；全 completed 时系统清空当前列表。
- `Read` 默认截断长文件，并以同一文件版本的累计读段决定是否解锁 `Write` / `Edit`。
- `Read` 默认按完整行截断长文件，并返回当前读取范围、总行数和继续读取 offset。
- `Read` 同时受行数和当前模型 context window 动态估算 token 预算限制，不返回半行；普通读取 1%，`full: true` 10%。
- `Write` 创建新文件不需要 read，更新既有文件必须先读段覆盖完整当前文件且通过 stale check。
- `Edit` 必须先读段覆盖完整当前文件，并保持精确匹配失败规则。
- `Glob` / `Grep` 使用 ripgrep 路径，支持分页和结构化结果。
- CLI 端到端验证仍覆盖搜索、读取、编辑、命令验证、TodoWrite、持久化和 resume。

**Steps**:

| Step | Spec | Goal | Status |
|---|---|---|---|
| M2.5.1 | [`S0012`](spec/ship/S0012-coding-tools-maturity.md) | 成熟化内置 coding tools 契约与实现。 | Done |

**Not in M2.5**:

- MultiEdit、checkpoint、sandbox、permission approval UI、LSP、background Bash、MCP。

**Status**: Done

---

## Future: Background Commands And Monitors

**Goal**: 为长时间运行的构建、测试、dev server、日志监控提供明确的后台任务模型，而不是把 monitor 语义塞进一次性 `Bash`。

**Candidate scope**:

- Background Bash / task id / poll / stop。
- 超长输出归档和增量读取。
- Dev server readiness 检测。
- 权限策略与 command classifier。

**Status**: Planned

---

## M3: Local Daemon

**Goal**: 多个本地 client 可以连接同一个 daemon，共享同一个 session 和事件流。

**Done when**:

- 本地 daemon 可独立启动。
- 本地 client 可 attach。
- 多 client 广播和断线补发可验证。

**Steps**:

| Step | Spec | Goal | Status |
|---|---|---|---|
| M3.1 | [`S0013`](spec/ship/S0013-local-daemon-protocol.md) | 补齐本地 daemon 所需的协议、socket transport 合同和边界测试入口。 | Done |
| M3.2 | [`S0014`](spec/ship/S0014-local-daemon-lifecycle.md) | 实现可独立启动/停止的本地 daemon 进程和连接发现状态。 | Done |
| M3.3 | [`S0015`](spec/ship/S0015-local-attach-and-broadcast.md) | 暴露 `scorel attach` 并验证多个本地 client 共享同一 session 事件流。 | Done |
| M3.4 | [`S0016`](spec/ship/S0016-local-daemon-resync-smoke.md) | 验证本地 client 断线重连后的 missed event 补发和真实产品端到端路径。 | Done |

**Not in M3**:

- Remote WebSocket control, TLS, remote token distribution.
- GUI / WebUI / IM channel.
- Permission tiers, sandbox, checkpoint restore.
- MCP / extension ecosystem loading.
- Daemon crash recovery beyond clean shutdown and reconnectable local socket state.

**Status**: Done

---

## M4: Remote Control

**Goal**: 用户可以在远端机器运行 daemon，并从本地安全控制同一个 agent。

**Done when**:

- WebSocket remote transport 可用。
- Token auth 可用。
- 远端断线恢复可用。
- 本地 CLI 可以连接远端 daemon，发起 prompt，并接收同一 session 的事件流。
- 远端路径通过真实 LLM provider、真实临时工作区和真实 JSONL session 的端到端验证；不使用 mock/fake provider，不为测试写特殊化产品路径。

**Steps**:

| Step | Spec | Goal | Status |
|---|---|---|---|
| M4.1 | [`S0019`](spec/ship/S0019-remote-transport-contract.md) | 锁定 remote transport、token auth、连接 URL 和断线恢复语义。 | Done |
| M4.2 | [`S0020`](spec/ship/S0020-remote-websocket-server.md) | 在 daemon 侧实现可测试的 WebSocket server primitive。 | Done |
| M4.3 | [`S0021`](spec/ship/S0021-remote-websocket-client-transport.md) | 在 client 侧实现 browser-safe WebSocket transport 和 remote resync。 | Done |
| M4.4 | [`S0022`](spec/ship/S0022-remote-daemon-cli-lifecycle.md) | 暴露远端 daemon serve 与 CLI remote attach 用户入口。 | Done |
| M4.5 | [`S0023`](spec/ship/S0023-remote-control-e2e-validation.md) | 端到端验证远端 daemon、本地控制、token auth、断线恢复和 coding flow。 | Done |
| M4.6 | [`S0025`](spec/ship/S0025-remote-attach-session-event-view.md) | 修复 remote attach 的 session event view 一致性、重连持久事件补偿和终端行边界。 | Done |

**Not in M4**:

- WebUI / GUI / mobile UI。
- TLS 自动签发、账号系统、OAuth、多人权限分级。
- 公网 tunnel / relay service / NAT traversal。
- Daemon supervisor、auto-restart、crash recovery beyond reconnectable remote state。
- Permission approval UI、sandbox、checkpoint restore。

**Status**: Done

---

## M5: WebUI

**Goal**: 用户可以通过浏览器 WebUI 观察和控制 remote daemon session。M5 只做 Web；GUI / Tauri / Electron 放到后续阶段。

**Done when**:

- WebUI 能添加并持久化 Device（Name / Link / Token）。
- WebUI 能通过已有 WebSocket remote transport 连接 remote daemon。
- WebUI 能按 Device -> Project -> Session 层级同步和展示远端索引。
- WebUI 能在用户打开 Session 后懒加载内容，并以 chatbox 形态展示事件流和工具调用。
- WebUI 能发 prompt / cancel，并和 CLI attach 共享同一 remote daemon session。

**Product Intent**:

M5 WebUI 的正式产品方向记录在 [`S0030`](spec/ship/S0030-webui-product-intent.md)。详细设计讨论在 [`self/discussions/2026-05-30-webui-rebuild-brainstorm.md`](../self/discussions/2026-05-30-webui-rebuild-brainstorm.md)。

**Steps**:

| Step | Spec | Goal | Status |
|---|---|---|---|
| M5.1 | [`S0031`](spec/ship/S0031-daemon-projectslug-rule.md) | 锁定 daemon 侧 codebuddy 风格 `projectSlug` 生成规则 | Planned |
| M5.2 | [`S0032`](spec/ship/S0032-daemon-protocol-completion.md) | 重新加回 `cancel`、实现 `list_sessions` + `projectSlug` 过滤、新增 `list_projects` | Done |
| M5.3 | [`S0033`](spec/ship/S0033-webui-skeleton-routing.md) | 建立 Next.js 14 App Router + Tailwind 4 应用骨架与路由 | Done |
| M5.4 | [`S0034`](spec/ship/S0034-webui-device-settings.md) | Device 域模型、BrowserStore 与 Settings CRUD | Done |
| M5.5 | [`S0035`](spec/ship/S0035-webui-device-handshake.md) | DaemonClient 实例池、handshake、连接状态机与错误分类 | Done |
| M5.6 | [`S0036`](spec/ship/S0036-webui-project-session-sync.md) | `list_projects` / `list_sessions` 同步与 sidebar 树渲染 | Done |
| M5.7 | [`S0037`](spec/ship/S0037-webui-chatbox-v1.md) | Chatbox v1：attach-cache 渲染、dual-seq resync、event 投影、prompt 发送 | Done |
| M5.8 | [`S0038`](spec/ship/S0038-webui-cancel-multiclient.md) | Composer Cancel + WebUI/CLI 多端共享同一 session 真实手工 e2e | Done |
| M5.9 | [`S0039`](spec/ship/S0039-webui-e2e-newchat.md) | New Chat + 真实 daemon + 真实 LLM provider 端到端验证；M5 收口 | Done |

**Not in M5**:

- GUI / Tauri / Electron / native desktop packaging。
- Local daemon process manager。
- OAuth、账号系统、TLS 自动签发。
- 公网 tunnel / relay service / NAT traversal。
- IDE-style file explorer/editor、monitoring dashboard、checkpoint restore UI、完整 rewind/fork/compact 图形交互。
- WebUI 内 Skills / Plugins / Automations 入口（v1 不出现，后续阶段再加）。

**Status**: Done

---

## M5.5: WebUI Polish (Codex Pass)

**Goal**: 把 v1 honest plain WebUI 升级到接近 Codex App 的视觉与交互质量：暖灰底 + ink-blue accent + serif 标题、markdown + 代码高亮、流式光标 + autoscroll。统一展示路径，不做 tool 特化、不引快捷键、不做 dark mode。

**Done when**:

- WebUI 全局走 design tokens，无 zinc 字面量灰阶。
- Chatbox 渲染 markdown + GFM + 代码高亮，sanitize 防 XSS。
- Streaming 体验：光标动画、rAF batch 整合 text_delta、IntersectionObserver autoscroll、jump-to-bottom 浮按钮。
- 所有改动通过自动测试 + 手工真实 LLM 烟雾。

**Product Intent**:

设计共识与库选型记录在 [`self/discussions/2026-05-31-webui-polish-brainstorm.md`](../self/discussions/2026-05-31-webui-polish-brainstorm.md) §5.5（决策）+ §8.2（markdown 调研结论）。

**Steps**:

| Step | Spec | Goal | Status |
|---|---|---|---|
| M5.5.1 | [`S0040`](spec/ship/S0040-webui-codex-visual-tokens.md) | Codex 风视觉一刀 + design tokens（CSS vars + Tailwind theme.extend） | Done |
| M5.5.2 | [`S0041`](spec/ship/S0041-webui-markdown-and-tool-block.md) | Chatbox markdown（react-markdown + GFM + sanitize + lazy Shiki）+ thinking 折叠 + 统一 tool 块走 JSON fence | Done |
| M5.5.3 | [`S0042`](spec/ship/S0042-webui-streaming-ux-autoscroll.md) | Streaming 光标动画、rAF batch、IntersectionObserver autoscroll、jump-to-bottom 浮按钮 | Done |

**Not in M5.5**:

- Dark mode（backlog）。
- Cmd+K / 全局快捷键 / sidebar 折叠持久化 / composer 历史回溯（backlog）。
- Tool block 特化（Bash/Edit/diff viewer/TodoWrite list；保持统一 JSON fence 渲染）。
- streamdown 切换（仅在 S0041 流式抖动反馈不可接受时跟进，不在 M5.5 范围）。
- Base UI 大规模引入（按需使用，本 milestone 仍 utility 主导）。

**Status**: Done

---

## M5.6: Startup Ergonomics

**Goal**: 把多二进制、多必填参数、多终端的启动流程,收敛为单 `scorel` 入口 + 持久 token + 一键 `scorel up`。WebUI 自动发现本地 daemon,避免手填。

**Done when**:

- `scorel` 单入口承载 chat / attach / daemon / webui / up / logs。
- `scorel-daemon` 二进制退役,`apps/daemon/` 删除。
- `scorel daemon serve` 全部 flag 有合理默认;token 在 `~/.scorel/daemon.json` 持久化,跨重启复用。
- `~/.scorel/daemon.json` 不再每次启动删除;通过 pid liveness + `stoppedAt` 判存活。
- WebUI Settings 页面通过 `/api/local-daemon` server route 自动发现本地 daemon,一键添加 device。
- `scorel up` 同时拉起 daemon serve + webui,Ctrl+C 一并退出。
- 全部改动通过自动测试,真实 LLM 手工烟雾通过。

**Steps**:

| Step | Spec | Goal | Status |
|---|---|---|---|
| M5.6.1 | [`S0043`](spec/ship/S0043-startup-ergonomics.md) | 单 `scorel` 入口 + 默认值 + token 持久化 + WebUI 自动发现 + `scorel up` | Done |

**Not in M5.6**:

- WebUI 多 daemon 切换 UI;每用户单 daemon 假设。
- 自动 supervisor / restart;仍需手工 `scorel daemon stop && serve`。
- Windows 专属 PID 语义。
- TLS / OAuth / 公网隧道。

**Status**: Done

---

## M5.7: WebUI Chatbox Rebuild

**Goal**: 推翻 M5.5 暖纸 + 墨蓝 + Newsreader serif 视觉,改为 ChatGPT 哲学(纯白 + 黑字 + sans + 极简)+ Chatbox 三段式 sidebar 结构。Project 节点独立折叠,Composer pill 形态,未实装功能用 Codex 风灰按钮占位。设计哲学固化到 `docs/design.md`。

**Done when**:

- `docs/design.md` 锁定视觉/交互真相源,后续 spec 引用本文件。
- `:root` tokens 重写为 ChatGPT 色板(`#FFFFFF` / `#0D0D0D` / `#F7F7F8` / 黑 accent),`--font-display` 删除,全 sans。
- Sidebar 三段式:顶部 4 行(`+ 新对话` active + 搜索/插件/自动化灰)→ 中段 device/project 树(▸/▾ 折叠 + localStorage 持久化)→ 底部 Settings + 主题切换灰。
- Topbar 删除。
- Composer 改 pill:`Message Scorel…` placeholder + 左 `⊕` 灰 + 右 `model ▾` 灰 + 右 `🎤` 灰 + 圆形黑 send / 红 cancel。
- User 气泡靠右 `max-w-[70%] rounded-lg bg-accent-soft`;assistant 无气泡贴 bg。
- `@fontsource/newsreader` 移除,boundary test 同步。
- 自动测试 + 真实 LLM e2e 通过。

**Product Intent**:

设计哲学见 [`docs/design.md`](design.md)。讨论与决策见 [`self/discussions/2026-05-31-webui-chatbox-rebuild-brainstorm.md`](../self/discussions/2026-05-31-webui-chatbox-rebuild-brainstorm.md) §5。

**Steps**:

| Step | Spec | Goal | Status |
|---|---|---|---|
| M5.7.1 | [`S0044`](spec/ship/S0044-webui-chatbox-rebuild.md) | 整 webui 一刀重构:tokens + 三段式 sidebar + 折叠 + composer pill + 灰按钮 + 气泡形态 | Planned |

**Not in M5.7**:

- 暗色模式实装(token 占位即可,后置 spec)。
- Cmd+K / 命令面板 / 全局快捷键。
- Sidebar 整体折叠到 56px(后置)。
- Composer `+` / `🎤` / model picker 真实功能(本轮仅灰按钮占位)。
- Tool block 特化(Bash/Edit/diff viewer);保持统一 JSON fence。
- Composer 历史回溯(↑ 键)。

**Status**: Planned

---

## M5.8: WebUI Card Sidebar + Session Cleanup

**Goal**: 修复 S0044 ship 后 verification 暴露的会话页结构偏差(SessionHeader / Chatbox 卡片外壳)+ stale-token 未捕获错误,并按用户二轮视觉迭代要求把 sidebar 改为单卡片浅灰底、project/device 行 click 即 toggle(无 ▸/▾)、session 行加相对时间 hint。

**Done when**:

- Sidebar 一整块卡片底无内分隔/边框;层级靠留白与 hover/active 底色。
- Project / Device 行 click = toggle 折叠,无路由跳转;Session 行单一进会话入口。
- Session 行右侧显示相对时间(`刚刚` / `3 周` / `1 个月` 等),每分钟刷新。
- SessionHeader / Chatbox 卡片外壳整删,transcript 直接贴主区 `bg-bg`。
- `WsTransport is not connected` 同步抛错被 client 公开 API 包成 `code: "transport_disconnected"` rejection,WebUI 显示友好 inline 降级提示,Next dev overlay 不再弹。
- WebUI 顶层 + session 路由 ErrorBoundary 兜底。
- 自动测试 + 手工 e2e 通过。

**Steps**:

| Step | Spec | Goal | Status |
|---|---|---|---|
| M5.8.1 | [`S0045`](spec/ship/S0045-webui-card-sidebar-and-session-fixes.md) | 单卡片 sidebar + 整行 toggle + 时间 hint + 删 SessionHeader/外壳 + transport-disconnected 错误吸收 | Planned |

**Not in M5.8**:

- 真实 ⌘1..9 跳转 / Cmd+B / 整 sidebar 折叠到 56px。
- "展开显示" 截断 UI / session 状态图标 / project 概览页改造。
- 暗色模式 / model picker 真实切换 / daemon 协议变化。

**Status**: Planned

---

## M5.9: WebUI Empty Composer + Lazy Session

**Goal**: 主区空态 `/` 改为 Codex/Chatbox 风的居中大 H1 + 大 composer + project picker;Sidebar `+ 新对话` 与 project 页 New Chat 按钮改为 nav 到此空态(继承 device/project query),首次 send 才创建 session,避免空 session 堆积。

**Done when**:

- `/` populated 状态展示 H1 "我们应该在 Scorel 中构建什么?" + pill composer + project select + 模式/分支灯。
- Project `<select>` 切换写 URL `?project=` + localStorage `scorel.ui.last-active-project`。
- Sidebar / project 页 `+ 新对话` nav 到 `/?device=&project=`,**不再立即 createSession**。
- 空态 composer onSend → createSession → sessionStorage `pending-prompt:<id>` → push session route。
- Session page mount 后消费 pending-prompt 一次性触发 send。
- 自动测试 + 手工 e2e 通过。

**Steps**:

| Step | Spec | Goal | Status |
|---|---|---|---|
| M5.9.1 | [`S0046`](spec/ship/S0046-webui-empty-composer-and-lazy-session.md) | EmptyComposer + lazy session 创建 + NewChatButton 改 nav | Planned |

**Not in M5.9**:

- Project hover `...` / ✏ 边控、底部装饰卡片、"完全访问权限"标签。
- 真实模式/分支/model 切换。
- daemon firstPrompt 一步协议。
- 多 device 切换 picker。

**Status**: Planned

---

## M6: Ecosystem

**Goal**: Scorel 可以通过 MCP、extensions、channels 接入外部工作流。

**Done when**:

- MCP 加载稳定。
- Extension 错误隔离。
- 至少一个 channel 可注入任务并回传结果。

**Status**: Planned

---

## Active Specs

| Spec | Purpose | Status |
|---|---|---|
| [`S0001`](spec/ship/S0001-docs-baseline.md) | 建立初始 docs baseline | Done |
| [`S0002`](spec/ship/S0002-package-skeleton.md) | 创建最终包骨架 | Done |
| [`S0003`](spec/ship/S0003-protocol-contracts.md) | 定义 M1 协议契约 | Done |
| [`S0004`](spec/ship/S0004-session-core.md) | 实现 JSONL session core | Done |
| [`S0005`](spec/ship/S0005-runtime-loop.md) | 实现最小 runtime loop | Done |
| [`S0006`](spec/ship/S0006-embedded-daemon-client.md) | 实现 embedded daemon + client | Done |
| [`S0007`](spec/ship/S0007-cli-alpha.md) | 实现 CLI Alpha | Done |
| [`S0008`](spec/ship/S0008-coding-tools.md) | 实现文件读写和命令执行工具 | Done |
| [`S0009`](spec/ship/S0009-code-discovery-tools.md) | 实现代码发现工具 | Done |
| [`S0010`](spec/ship/S0010-todo-tool-and-cli.md) | 实现 Todo 工具和 CLI 可见状态 | Done |
| [`S0011`](spec/ship/S0011-coding-agent-alpha-smoke.md) | 验证 M2 coding agent alpha 端到端体验 | Done |
| [`S0012`](spec/ship/S0012-coding-tools-maturity.md) | 成熟化内置 coding tools 契约与实现 | Done |
| [`S0013`](spec/ship/S0013-local-daemon-protocol.md) | 补齐本地 daemon 协议与 socket transport 合同 | Done |
| [`S0014`](spec/ship/S0014-local-daemon-lifecycle.md) | 实现本地 daemon 进程生命周期和连接发现 | Done |
| [`S0015`](spec/ship/S0015-local-attach-and-broadcast.md) | 实现本地 attach 与多 client 广播 | Done |
| [`S0016`](spec/ship/S0016-local-daemon-resync-smoke.md) | 验证本地 daemon 断线补发与端到端路径 | Done |
| [`S0017`](spec/ship/S0017-grep-files-output-mode.md) | 简化 Grep 文件路径输出模式命名 | Done |
| [`S0018`](spec/ship/S0018-daemon-entrypoint-smoke.md) | 修复 daemon app 开发态入口执行路径 | Done |
| [`S0019`](spec/ship/S0019-remote-transport-contract.md) | 锁定 remote transport、token auth 和断线恢复合同 | Done |
| [`S0020`](spec/ship/S0020-remote-websocket-server.md) | 实现 daemon 侧 remote WebSocket server primitive | Done |
| [`S0021`](spec/ship/S0021-remote-websocket-client-transport.md) | 实现 client 侧 remote WebSocket transport | Done |
| [`S0022`](spec/ship/S0022-remote-daemon-cli-lifecycle.md) | 暴露远端 daemon serve 和 CLI remote attach 入口 | Done |
| [`S0023`](spec/ship/S0023-remote-control-e2e-validation.md) | 验证 M4 remote control 端到端产品路径 | Done |
| [`S0024`](spec/ship/S0024-remote-attach-interactive-stream.md) | 修复 remote attach 交互订阅和多端事件流 | Done |
| [`S0025`](spec/ship/S0025-remote-attach-session-event-view.md) | 修复 remote attach session event view 一致性和重连补偿 | Done |
| [`S0026`](spec/ship/S0026-attach-project-cache-and-dual-seq-reconnect.md) | 收敛 attach 的 project-scope session cache、dual-seq reconnect 与 fallback/live 语义 | Done |
| [`S0027`](spec/ship/S0027-session-diagnostics-log.md) | 为每个 session 增加同目录 diagnostics `.log`，暴露 provider/runtime/daemon 调试信息 | Done |
| [`S0028`](spec/ship/S0028-client-attach-diagnostics-log.md) | 为本地 attach cache 增加同级 diagnostics `.log`，暴露 remote/local attach 客户端侧调试信息 | Done |
| [`S0029`](spec/ship/S0029-project-index-for-session-lookup.md) | 增加轻量 project index，用 project 视角索引 local/remote sessions 与 attach logs | Done |
| [`S0030`](spec/ship/S0030-webui-product-intent.md) | 记录 M5 WebUI 产品方向：Device -> Project -> Session -> Chatbox，作为下一轮实现前置共识 | Planned |
| [`S0031`](spec/ship/S0031-daemon-projectslug-rule.md) | 锁定 daemon 侧 codebuddy 风格 `projectSlug` 生成规则 | Planned |
| [`S0032`](spec/ship/S0032-daemon-protocol-completion.md) | 重新加回 `cancel`，实现 `list_sessions` + `projectSlug` 过滤，新增 `list_projects` | Done |
| [`S0033`](spec/ship/S0033-webui-skeleton-routing.md) | Next.js 14 App Router + Tailwind 4 应用骨架与路由 | Done |
| [`S0034`](spec/ship/S0034-webui-device-settings.md) | WebUI Device 域模型、BrowserStore、Settings CRUD | Done |
| [`S0035`](spec/ship/S0035-webui-device-handshake.md) | WebUI DaemonClient 实例池与 Device 连接握手 | Done |
| [`S0036`](spec/ship/S0036-webui-project-session-sync.md) | WebUI Project / Session 索引同步与 sidebar 树渲染 | Done |
| [`S0037`](spec/ship/S0037-webui-chatbox-v1.md) | WebUI Chatbox v1：attach-cache 渲染、dual-seq resync、event 投影、prompt 发送 | Done |
| [`S0038`](spec/ship/S0038-webui-cancel-multiclient.md) | WebUI Composer Cancel 与多端共享真实 session 验证 | Done |
| [`S0039`](spec/ship/S0039-webui-e2e-newchat.md) | WebUI New Chat 与真实 daemon 端到端验证（M5 收口） | Done |
| [`S0040`](spec/ship/S0040-webui-codex-visual-tokens.md) | WebUI Codex 风视觉一刀与 design tokens | Done |
| [`S0041`](spec/ship/S0041-webui-markdown-and-tool-block.md) | WebUI markdown 渲染、代码高亮与统一 tool 块 | Done |
| [`S0042`](spec/ship/S0042-webui-streaming-ux-autoscroll.md) | WebUI streaming UX 与 autoscroll | Done |
| [`S0043`](spec/ship/S0043-startup-ergonomics.md) | 单 `scorel` 入口、token 持久化、WebUI 自动发现、`scorel up` 一键启动 | Done |
| [`S0044`](spec/ship/S0044-webui-chatbox-rebuild.md) | WebUI 一刀重构为 Chatbox 风 + ChatGPT 哲学(推翻 M5.5) | Planned |
| [`S0045`](spec/ship/S0045-webui-card-sidebar-and-session-fixes.md) | 单卡片 sidebar + 整行 toggle + 时间 hint + 删 SessionHeader/外壳 + transport guard | Planned |
| [`S0046`](spec/ship/S0046-webui-empty-composer-and-lazy-session.md) | 空态主区大 composer + project picker + lazy session 创建 | Planned |

---

## Rules

- Roadmap 不提前占用未来 S 编号。
- 只有准备进入某个阶段时，才创建该阶段的具体 S spec。
- 每个 S spec 必须可独立实现、测试、提交。
- 默认版本 bump 是 patch；minor / major 只在用户明确指定时执行。
