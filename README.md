# Scorel

Scorel 是一个面向项目工作的 AI Agent Platform。

它把一次 Agent 任务放在真实工作区里运行：Session 写成 JSONL，工具调用和结果进入事件流，Host 统一管理 Project、Session、Runtime 和多端连接。CLI、WebUI、GUI 都只是入口，不直接拥有会话状态。

当前重点是 coding agent：搜索、读文件、编辑文件、运行命令、记录任务进度、恢复历史会话，以及通过本地或远程入口继续控制同一个 Agent。

## Quick Start

安装依赖：

```bash
pnpm install
```

在当前目录启动一个交互式 Agent 会话：

```bash
pnpm scorel
```

启动桌面 GUI：

```bash
pnpm gui
```

启动本机 Host，并连接默认 Relay：

```bash
pnpm scorel host serve
```

打开 hosted WebUI：

```text
https://scorel.chanler.dev
```

WebUI 显示 pair code 后，在本机授权：

```bash
pnpm scorel pair <pair-code>
```

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
- `harness_item`：系统注入给模型的上下文，例如 memory、skill listing、steer。
- `user_message`：用户输入。
- `assistant_message`：模型输出。
- `tool_result`：工具执行结果。
- `queue_update`：follow-up / steer 队列状态。
- `skill_index_snapshot` / `skill_index_delta`：Skill 路由表。

JSONL 是恢复会话的事实来源。`buildContext()` 从事件树构造下一轮 LLM messages；UI 则从同一条事件流投影 transcript、工具块、运行状态和队列状态。

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
- Relay device pairing 和 remote project 选择。

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
- provider/model profile 和 auxiliary model。

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
- [docs/spec/daemon.md](docs/spec/daemon.md)
- [docs/spec/client.md](docs/spec/client.md)
- [docs/spec/relay.md](docs/spec/relay.md)
