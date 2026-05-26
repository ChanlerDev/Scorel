# Scorel Roadmap

> Roadmap 只定义产品阶段目标，不提前展开未来实现细节。进入某个阶段前，再把该阶段拆成具体 `S####` spec。

---

## Product Direction

Scorel 是一个 **可回放、可恢复、可远程控制的 AI Agent 工作台**。

推进顺序：

```text
Design Baseline → CLI Alpha → Safe Coding CLI → Local Daemon → Remote Control → Web/GUI → Ecosystem
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
| M1.3 | [`S0004`](spec/ship/S0004-session-core.md) | 实现 append-only JSONL session 和 context replay，让对话成为可恢复资产。 | Planned |
| M1.4 | [`S0005`](spec/ship/S0005-runtime-loop.md) | 实现最小 runtime loop，让给定 context 能产生可测试的 assistant event stream。 | Planned |
| M1.5 | [`S0006`](spec/ship/S0006-embedded-daemon-client.md) | 用 embedded daemon + DaemonClient 串起 session、runtime 和事件流。 | Planned |
| M1.6 | [`S0007`](spec/ship/S0007-cli-alpha.md) | 暴露 `scorel chat`，验证用户可见的本地多轮对话体验。 | Planned |

**Not in M1**:

- Local socket / WebSocket daemon.
- Remote control, auth, reconnect after process boundary.
- File checkpoint, rewind UX, compact UX, permission policy.
- WebUI / GUI / channels / MCP tiered loading.

**Status**: Planned

---

## M2: Safe Coding CLI

**Goal**: 用户敢让 agent 修改真实仓库，因为文件改动、上下文和中断状态都可恢复。

**Done when**:

- 写类工具有 checkpoint。
- rewind / compact / cancel / steer / followUp 可用。
- CLI 能操作核心恢复能力。

**Status**: Planned

---

## M3: Local Daemon

**Goal**: 多个本地 client 可以连接同一个 daemon，共享同一个 session 和事件流。

**Done when**:

- 本地 daemon 可独立启动。
- 本地 client 可 attach。
- 多 client 广播和断线补发可验证。

**Status**: Planned

---

## M4: Remote Control

**Goal**: 用户可以在远端机器运行 daemon，并从本地安全控制同一个 agent。

**Done when**:

- WebSocket remote transport 可用。
- Token auth 可用。
- 远端断线恢复可用。

**Status**: Planned

---

## M5: Web / GUI

**Goal**: 用户可以通过图形界面观察和控制 daemon session。

**Done when**:

- WebUI 或 GUI 能连接 daemon。
- 能展示 session tree、事件流和工具调用。
- 能发 prompt / cancel。

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
| [`S0004`](spec/ship/S0004-session-core.md) | 实现 JSONL session core | Planned |
| [`S0005`](spec/ship/S0005-runtime-loop.md) | 实现最小 runtime loop | Planned |
| [`S0006`](spec/ship/S0006-embedded-daemon-client.md) | 实现 embedded daemon + client | Planned |
| [`S0007`](spec/ship/S0007-cli-alpha.md) | 实现 CLI Alpha | Planned |

---

## Rules

- Roadmap 不提前占用未来 S 编号。
- 只有准备进入某个阶段时，才创建该阶段的具体 S spec。
- 每个 S spec 必须可独立实现、测试、提交。
- 默认版本 bump 是 patch；minor / major 只在用户明确指定时执行。
