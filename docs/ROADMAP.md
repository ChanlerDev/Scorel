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

**Status**: In Progress

---

## M1: CLI Alpha

**Goal**: 用户可以在本地运行 `scorel chat`，完成最小多轮 agent loop，并持久化 session。

**Done when**:

- CLI 通过 daemon/client 抽象运行，而不是直接持有 runtime。
- 一轮 LLM + tool loop 可完成。
- JSONL session 可恢复。
- 基础测试和 typecheck 通过。

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
| [`S0002`](spec/ship/S0002-package-skeleton.md) | 创建最终包骨架 | Planned |

---

## Rules

- Roadmap 不提前占用未来 S 编号。
- 只有准备进入某个阶段时，才创建该阶段的具体 S spec。
- 每个 S spec 必须可独立实现、测试、提交。
- 默认版本 bump 是 patch；minor / major 只在用户明确指定时执行。
