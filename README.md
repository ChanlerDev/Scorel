# Scorel

Scorel 是一个面向项目工作的 AI Agent Platform。

它把一次 Agent 任务放在真实工作区里运行：Session 写成 JSONL，工具调用和结果进入事件流，Host 统一管理 Project、Session、Runtime 和多端连接。CLI、WebUI、GUI 都只是入口，不直接拥有会话状态。

当前重点是 coding agent：搜索、读文件、编辑文件、运行命令、记录任务进度、恢复历史会话，以及通过本地或远程入口继续控制同一个 Agent。

## Benchmark

| Benchmark | Scorel | Model | Reasoning effort | K | Cases | Trials | Mean reward | Pass@2 | Errors | Harbor |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Terminal-Bench 2.1 | v0.0.9 | GPT-5.5 | — | 2 | 89 | 178 | 70.22% | 78.65% | 3 | [Results](https://hub.harborframework.com/jobs/d5a9df2c-318c-4fd1-b9aa-b7afdab6854f) |
| Terminal-Bench 2.1 | v0.0.12 | DeepSeek V4 Flash | — | 1 | 89 | 89 | 78.65% | — | 2 | [Results](https://hub.harborframework.com/jobs/b34732f7-722c-4159-a6eb-c7ca598fbafc) |
| Terminal-Bench 2.1 | v0.0.13 | GPT-5.6 Luna | Max | 2 | 89 | 178 | 75.28% | 83.15% | 3 | [Results](https://hub.harborframework.com/jobs/9762313c-6d68-4dc3-8f71-3c5f3540794d) |

## Quick Start

安装依赖：

```bash
pnpm install
```

在当前目录启动一个交互式 Agent 会话：

```bash
pnpm scorel
```

查看版本、手动更新 CLI：

```bash
scorel --version
scorel update
# alias
scorel upgrade
```

非交互式 benchmark / harness 入口使用 `scorel run`。`--summary` 写单个机器可读 JSON；`--report-dir` 额外写 `scorel-summary.json`、`scorel-events.jsonl`、`scorel-trajectory.json` 和 `scorel-metadata.json`，用于 Harbor / Terminal-Bench 这类 job 收集本地观测数据：

```bash
scorel run --prompt-file /tmp/instruction.txt \
  --cwd /workspace \
  --state-dir /tmp/scorel-state \
  --reasoning-effort high \
  --summary /logs/agent/scorel-summary.json \
  --report-dir /logs/artifacts/scorel
```

`--reasoning-effort` 接受 `minimal`、`low`、`medium`、`high`、`xhigh` 和 `max`；`max` 会在 OpenAI-compatible 请求中发送为 `reasoning_effort: "max"`。省略时不传显式 effort，保留现有 pi-ai 默认行为。summary/report 文件包含 status、session 路径、captured events、token usage、model/provider、reasoning effort、estimated cost 和 report references。每个 session 还会在同目录维护 `<sessionId>.summary.json` 作为 session 级观测缓存，交互式 CLI、GUI、`scorel run` 和外部 harness 可以读取同一份 usage/model/cost summary；append-only session JSONL 仍是 source of truth。Cost 来自 Scorel 内置的 models.dev 官方 provider 价格快照，单位是 USD / 1M tokens；未知或非官方 model id 会标记为 unknown，不会伪造费用。Scorel 只产出本地文件，不直接执行 Harbor upload。

后台 Host 会每小时检查一次 npm 上的 `@chanlerdev/scorel`。发现新版本后，只有在没有 active work，或者 active work 已经连续三小时没有进展时，才会执行同一套 npm 更新；更新成功后 Host 会短暂停止，下一次 CLI / GUI / WebUI 入口启动时使用新版本。

启动桌面 GUI，本机会启动 embedded Host：

```bash
pnpm gui
```

打包 macOS GUI：

```bash
pnpm --filter @scorel/app-gui dist:mac
```

GUI 跟随正常 release 节奏发布到同一个 GitHub Release。Release assets 包含 dmg / zip、`latest-mac.yml` 和 blockmap 文件；packaged GUI 通过 `electron-updater` 读取这些 metadata 做增量更新。

Packaged GUI 自带同版本 CLI runtime：`Scorel.app/Contents/Resources/scorel` 会通过 app 自己的 Electron executable 以 Node mode 运行 `scorel.js`，再启动本机 Host。它不依赖用户全局安装的 `node`、`scorel`、nvm PATH 或源码仓库路径。

当前没有 Apple Developer signing/notarization 时，macOS 首次打开下载的 app 可能被 Gatekeeper 拦截。确认来源可信后，可以移除 quarantine 标记：

```bash
xattr -dr com.apple.quarantine /Applications/Scorel.app
```

启动本机 Host：

```bash
pnpm scorel host serve
```

指定初始 Project、端口或 token：

```bash
pnpm scorel host serve --project /path/to/project --host 127.0.0.1 --port 7777 --token <token>
```

查看、停止或重置本机 Host：

```bash
pnpm scorel host status --show-token
pnpm scorel host stop
pnpm scorel host reset
```

连接 Relay，并用 hosted WebUI 控制本机 Host：

```bash
pnpm scorel host serve --relay wss://scorel-relay.chanler.dev
```

打开 hosted WebUI：

```text
https://scorel.chanler.dev
```

WebUI 显示 pair code 后，在本机授权：

```bash
pnpm scorel pair <pair-code> --relay wss://scorel-relay.chanler.dev
```

配对只是授权远端 Entry 访问这个 Host；Project、Session、Runtime 仍然在本机 Host 上。

启动本地 WebUI：

```bash
pnpm scorel webui --port 3000
```

## ACP (Agent Client Protocol)

Scorel 可以作为 ACP agent 运行，让任何实现 ACP 的编辑器（Zed、JetBrains、Neovim、Emacs 等）以子进程方式启动 Scorel 并通过 stdin/stdout 上的 JSON-RPC 驱动它。ACP 会话走的是和 `scorel chat` / `scorel run` 完全相同的执行路径：真实 ScorelHost、Session JSONL 持久化、工具循环和 replay，编辑器只是另一个 Entry。

```bash
scorel acp
# 可选：指定工作目录、state 目录
scorel acp --cwd /path/to/project --state-dir ~/.scorel
```

在 Zed 里把 Scorel 注册为外部 agent：

```json
// ~/.config/zed/settings.json
{
  "assistant": {
    "edit_predictions": { "disabled": true },
    "agents": [
      { "name": "scorel", "command": "scorel", "args": ["acp"] }
    ]
  }
}
```

支持的 ACP 方法：`initialize`、`session/new`、`session/load`（replay 历史）、`session/prompt`（流式 `session/update` 通知）、`session/cancel`、`session/close`。Scorel 事件映射：`text_delta` → `agent_message_chunk`，`thinking_delta` → `agent_thought_chunk`，工具调用 → `tool_call` / `tool_call_update`。

Telegram IM 入口可以在 GUI 的 Settings -> IM 里启用，也可以手写用户级配置：

```toml
[extensions.telegram]
enabled = true
kind = "im"

[extensions.telegram.config]
credentialMode = "env"
botTokenEnv = "SCOREL_TELEGRAM_BOT_TOKEN"
pollIntervalMs = 1000
```

或者直接把 Bot API key 写进本机配置：

```toml
[extensions.telegram]
enabled = true
kind = "im"

[extensions.telegram.config]
credentialMode = "direct"
apiKey = "123456:telegram-bot-token"
pollIntervalMs = 1000
```

QQ Bot 和微信 / 企业微信入口在 GUI 的 Settings -> IM 里走更短的明文配置路径。QQ 填开放平台管理端的 `App ID` 和 `App Secret`，Scorel 会自动换取并刷新 Access Token，并通过官方 WebSocket Gateway 接收入站消息：

```toml
[extensions.qq]
enabled = true
kind = "im"

[extensions.qq.config]
appId = "..."
appSecret = "..."
botId = "..."
allowedConversationIds = "..."
```

微信 / 企业微信分成两条官方能力面：

- 企业微信群机器人 Webhook：只用于出站发送，不能接收群里用户消息。
- 公众号 plaintext callback：用于接收用户发来的微信消息，需要微信后台配置可访问的 callback URL 和同一个 Token。

出站群机器人配置：

```toml
[extensions.wechat]
enabled = true
kind = "im"

[extensions.wechat.config]
webhookUrl = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
```

入站 callback 配置：

```toml
[extensions.wechat]
enabled = true
kind = "im"

[extensions.wechat.config]
callbackToken = "..."
callbackHost = "127.0.0.1"
callbackPort = 0
```

然后启动本机 Host 或 GUI。Telegram 使用 Bot API long polling，不需要 Relay 或 webhook。QQ 使用官方 WebSocket Gateway，不需要公网回调。微信 callback 如果要被微信服务器访问，需要用公网 URL 或隧道转发到本机 callback server。

本地开发常用检查：

```bash
pnpm typecheck && pnpm test
```

## Current Shape

Scorel 的核心边界是：

- `@scorel/protocol`：跨包共享的 ID、wire message、事件类型和 transport contract。
- `@scorel/core`：Session、Runtime、工具、配置、Prompt assembly、Memory、Skills。
- `@scorel/daemon`：Device-level Host，管理 Project Registry、Session JSONL、Runtime、事件广播和远程连接。
- `@scorel/client`：DaemonClient、request/response、resync、browser-safe transport。
- `apps/cli`：命令行入口。
- `apps/webui`：浏览器入口。
- `apps/gui`：桌面入口。
- `apps/relay`：Relay proxy，不持有 Project、Session 或 Runtime。

运行模型是：

```text
Entry (CLI / WebUI / GUI)
  -> DaemonClient / transport
  -> ScorelHost
  -> ScorelRuntime
  -> tools + provider
```

## Session Storage

Session 是 append-only JSONL。Host 是唯一 writer，Entry 不直接写会话文件。

一次会话里会写入这些事件：

- `instruction_snapshot`：Session 初始化时冻结的系统提示词来源。
- `harness_item`：运行中或 session 级注入给模型的上下文，例如 memory、skill listing、steer；进入模型前会转成结构化 `system_reminder` block。
- `user_message`：用户输入。
- `assistant_message`：模型输出。
- `tool_result`：工具执行结果。
- `compact`：旧上下文的压缩摘要，作为后续 `buildContext()` 的 replay barrier。
- `context_control`：上下文投影控制，例如 `snip` 隐藏某个已完成 user turn，使它不再进入未来 LLM context。
- `queue_update`：follow-up / steer 队列状态。
- `skill_index_snapshot` / `skill_index_delta`：Skill 路由表。

JSONL 是恢复会话的事实来源。`buildContext()` 从事件树构造下一轮 canonical LLM messages；遇到 `compact` 时，会用 `system_reminder kind="compact_summary"` 替换更早上下文，并最多保留最近 8 条从 `user_message`、`compact` 或带 `tool_call` 的 `assistant_message` 边界开始的原始 conversation events；遇到 `context_control operation="hide_user_turn"` 时，会从未来模型上下文中过滤对应 user turn span。UI 则从同一条事件流投影 transcript、工具块、运行状态和队列状态。

`system_reminder` 是结构化 content block，不是 JSONL 事件类型，也不是 provider-level system prompt。它可以作为 user message 的 model-only sidecar（例如当前 turn 信息、`snip.userMessageId`、用户引用），也可以由 `harness_item` / `compact` 在 `buildContext()` 时产生。Provider adapter 最后才把它 lower 成 `<system-reminder>...</system-reminder>` 文本；GUI / WebUI / CLI 只按 block type 和 `visibility` 决定展示，不解析 XML。

这个设计的重点不是“保存聊天记录”，而是让 Agent 的输入、输出、工具调用、控制事件和恢复状态都落在同一条可检查的链路里。

## System Prompt

Scorel 不在每轮临时拼一段不可追踪的 prompt。第一次 user turn 前，Host 会生成 `instruction_snapshot` 并写入 JSONL。

Snapshot 目前包含：

- baseline prompt：Scorel 自带的基础行为约束。
- AGENTS.md：从项目目录向上发现的项目指令，以及 `~/.scorel/AGENTS.md`。
- memory section：结构预留；实际 memory 内容不放在 provider-level system prompt。
- workspace：当前 cwd、repo root、顶层目录摘要。
- environment：平台、shell 等运行环境。
- time：Session 初始化时间。

后续 turn 都从这份 snapshot 渲染 provider-level `systemPrompt`。同一个 session 内，磁盘上的 AGENTS.md 变化不会自动改变这次会话的 system prompt。

## Memory

Memory 是文件系统 backed，固定在用户目录：

```text
~/.scorel/memory/
  MEMORY.md
  projects/
    <projectId>/
      MEMORY.md
      daily/
        YYYY-MM-DD.md
```

Memory 的链路分三段：

1. Session 初始化时，Host 读取 root memory、project memory、今天/昨天 daily，注入一次 hidden `harness_item kind="memory"`。
2. 如果 `AppendDaily` 工具可用，模型在完成有意义工作后调用它，把 summary、completed、decisions、followUps、memoryCandidates 追加到当天 daily。
3. 项目空闲后，auxiliary model 读取 daily 和当前 memory，把稳定内容整理进 project/root `MEMORY.md`。

当前规则是：一个 session 只注入一次 memory harness。Daily 和 dream 更新是给未来 session 用的，不刷新当前 session 的上下文。

Auto compact 是当前 session 的上下文管理，不是长期 memory。Host 在每轮新用户消息写入前估算 context，默认达到模型窗口 80% 时追加 `compact` 事件。`compact` 优先使用后台维护的 session memory；如果 session memory 不存在或关闭，会降级到 foreground compact。后台 session memory 正在更新时，Host 最多等待 5 秒，然后继续执行，不让用户 turn 无限等待。

`snip` 是另一种当前 session 的上下文管理：Host 创建每条 `user_message` 时会持久写入一个 model-only 的 `system_reminder kind="message_ref"`，内容包含短 `snip.userMessageId`。UI 不展示，但模型能用它通过 Host 注册的 `snip` 工具请求隐藏其中一个已完成 user turn。因为这个 id 随消息创建时固定下来，后续 `buildContext()` replay 不会动态改写历史 user message，也不会破坏 prompt cache 前缀。Host 会校验目标 `user_message` 在当前 active path 上，并 append `context_control` 事件；原始 JSONL 不删除、不重写，只是后续 `buildContext()` 不再把该 span 放进模型输入。

Session memory 写在：

```text
~/.scorel/context/session-memory/<projectId>/<sessionId>.md
```

它只服务当前 session 的 auto compact，不写入 root/project `MEMORY.md`。GUI Settings 的 Memory 区域可以开关 session memory，并配置 auto compact 阈值。

`AppendDaily` 返回的是普通 tool result，例如：

```text
Daily appended: 2026-06-11
```

并带上写入路径和日期。它不把 memory 内容重新塞回当前 prompt。

## Skills

Skill 是一套轻量的 instruction loading 机制，不是插件运行时。

Scorel 会扫描：

```text
~/.scorel/skills/<skill-name>/SKILL.md
<project>/.scorel/skills/<skill-name>/SKILL.md
```

扫描结果写入 session JSONL 的 `skill_index_snapshot` 或 `skill_index_delta`。模型看到的是一个 skill listing reminder，但真正的路由表来自 JSONL 里的结构化 skill index。

模型需要使用某个 skill 时，调用内置工具：

```text
Skill({ name: "..." })
```

Scorel 根据 index 找到对应 `SKILL.md`，把完整内容作为工具结果返回。V1 不执行 skill 里的脚本，也不做 marketplace、embedding search 或自动 ranking。

## Extensions And IM Channels

Extension 是 Scorel 的外部能力容器。当前落地的是 manifest-driven IM extension；它先服务 Telegram 这类消息入口，后续可以继续承载 skills、MCP 声明和更多 adapter。

一个 extension 目录的核心结构是：

```text
extensions/builtin/telegram/
  scorel.extension.json
  adapter.js
  skills/
    telegram/
      SKILL.md
```

Manifest 里声明 extension id、类型、adapter 和 skill roots：

```json
{
  "id": "telegram",
  "kind": "im",
  "displayName": "Telegram",
  "adapter": "./adapter.js",
  "skills": ["./skills"]
}
```

Host 启动或 GUI 更新 IM 设置时读取 `~/.scorel/config.toml` 中 enabled 的 extension。内置 extension 随包放在 `extensions/builtin/`，用户 extension 放在 `~/.scorel/extensions/`。单个 adapter 启动失败只写 diagnostics，不影响 Host、Session 或其他 extension。

IM channel 的运行链路是：

```text
IM Adapter
  -> ScorelHost channel bridge
  -> fixed Session binding
  -> existing send_message runtime path
  -> SendChannelMessage tool
  -> IM Adapter
```

Adapter 只负责平台 IO：轮询或接收外部消息、把消息转成 `ImIncomingMessage`、把 outgoing text 发回平台。它不创建 Session，不写 JSONL，不实现 follow-up / steer，也不读写 memory。

Host bridge 负责：

- 把 `(extensionId, externalConversationId)` 绑定到固定 `sessionId`。
- 使用默认 workspace：`~/.scorel/workspace`。
- 在 GUI Host 中把后台 IM 新建 session 的 Project 变化主动通知 GUI，侧边栏不需要靠手动展开或定时轮询才看到新 IM session。
- 把 IM 消息提交到现有 `send_message` 路径。
- 在用户消息前注入 hidden `harness_item kind="channel_context"`，说明来源 channel、conversation type、sender display name、是否 mention bot。
- 为当前 IM turn 暴露 `SendChannelMessage`。

`SendChannelMessage` 是模型回复 IM 的唯一工具面：

```text
SendChannelMessage({ text: "..." })
```

模型不需要也不应该填写 Telegram chat id、飞书 open id、Slack channel id 这类 raw routing id。raw id 只存在 adapter/bridge context 里；模型看到的是“这条消息来自 Telegram 群聊/私聊，当前应该回复这个 conversation”。

Telegram 是第一个 built-in IM provider：

- 私聊消息直接进入固定 session。
- 群聊 / supergroup 只有 mention bot 或 reply bot 时进入 Scorel。
- 同一个 Telegram chat 复用同一个 Scorel session。
- `credentialMode = "env"` 时从 `botTokenEnv` 读取 token。
- `credentialMode = "direct"` 时直接读取 `apiKey`。
- V1 只发纯文本，不做 webhook、媒体、inline keyboard 或主动跨 chat 发送。

QQ Bot 和微信 / 企业微信沿用同一条 channel bridge：

- QQ 使用官方 `App ID` / `App Secret` 换取 Access Token，发送消息走 REST API，接收消息走官方 WebSocket Gateway。
- 微信 / 企业微信群机器人 Webhook 只负责出站发送。
- 微信入站接收走公众号 plaintext callback；当前不实现个人微信自动化、企微加密回调解密、公网 tunnel 或 TLS 托管。
- QQ 和微信默认都不要求用户配置 env var。

## Editing Mode

Coding 能力由内置工具提供，不让模型直接把所有事情都塞进 shell。

当前主要工具：

- `Read`：读取文件，返回稳定行号；长文件按行截断；同一版本下读段可累计。
- `Write`：创建新文件或完整重写文件；更新既有文件前必须完整读过当前文件。
- `Edit`：精确字符串替换；要求完整读覆盖；读后文件变化会失败；匹配不到或不唯一会失败。
- `Glob` / `Grep`：基于 ripgrep 的结构化文件发现和内容搜索。
- `Bash`：执行命令，带 cwd、超时、输出截断。
- `TodoWrite`：完整替换当前 todo list，用于多步骤任务状态。

编辑态的关键约束是 read-before-write 和 stale check。这样可以避免模型基于过期文件内容写入，也让失败变成可读的 tool result，而不是静默破坏工作区。

## Remote Control

远程控制不是另一套后端。Project、Session、Runtime、JSONL 仍然属于用户设备上的 Host。

直连路径：

```text
Entry -> WebSocket -> Host
```

Relay 路径：

```text
Entry -> Relay -> Host
```

Relay 只做两件事：

- 让 Entry 和 Host 在公网不可直连时通过稳定服务相遇。
- 保存 `deviceId -> clientId` 授权关系，并转发 daemon wire payload。

Relay 不存 Project Registry，不存 Session JSONL，不存 prompt、tool result、provider response，也不做 replay 或 Runtime 调度。

Host 仍然是唯一 session writer。不同入口通过同一套 DaemonClient 协议连接 Host，因此 CLI、WebUI、GUI 可以看到同一个 session 的事件流，并在断线后通过 resync 补回缺失事件。

## GUI And WebUI

WebUI 和 GUI 都围绕同一个模型：

```text
Device -> Project -> Session
```

GUI 更偏本地桌面工作台，WebUI 更偏 hosted/remote control。二者都不拥有会话状态，只通过 Host 读写 Project、Session、模型配置、memory 设置和事件流。

当前 UI 已支持：

- Project-first sidebar。
- Session transcript。
- Streaming assistant output。
- Read / Glob / Grep / Edit / Write / Bash / TodoWrite 的专用 tool block。
- follow-up / steer / cancel。
- provider/model settings。
- memory settings。
- IM settings，包括 Telegram enable、env/direct token、allowed chats、QQ App ID / App Secret、WeChat outbound webhook 和 inbound callback。
- Relay device pairing 和 remote project 选择。
- packaged GUI auto-update。
- macOS menu bar status menu with Show, Settings, Check for Updates, Host status, and Quit.

## Status

已经落地的主线能力：

- CLI agent loop。
- append-only JSONL session。
- 本地 Host / client / attach。
- coding tools。
- WebSocket remote attach。
- Relay + hosted WebUI。
- Project Registry。
- GUI。
- AGENTS.md instruction snapshot。
- Skill index + Skill tool。
- memory harness + AppendDaily + idle dream。
- context control + `snip` tool。
- provider/model profile 和 auxiliary model。
- extension manifest + IM channel bridge。
- built-in Telegram IM extension。
- built-in QQ Bot IM extension。
- WeChat outbound webhook 和 official-account style plaintext callback。
- GUI IM settings。
- CLI update/upgrade。
- GUI release assets with incremental update metadata。
- packaged GUI bundled CLI runtime for local Host startup。

计划中的方向：

- SSH remote device。
- HTTP API。
- 更完整的 MCP / extension ecosystem。
- 权限审批、sandbox、checkpoint 等更强安全边界。

## Docs

更细的设计文档在 `docs/`：

- [docs/architecture.md](docs/architecture.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
- [docs/SHIP.md](docs/SHIP.md)
- [docs/spec/session.md](docs/spec/session.md)
- [docs/spec/runtime.md](docs/spec/runtime.md)
- [docs/spec/tools.md](docs/spec/tools.md)
- [docs/spec/extensions.md](docs/spec/extensions.md)
- [docs/spec/channels.md](docs/spec/channels.md)
- [docs/spec/daemon.md](docs/spec/daemon.md)
- [docs/spec/client.md](docs/spec/client.md)
- [docs/spec/relay.md](docs/spec/relay.md)
