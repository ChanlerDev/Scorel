# ADR-005：AI 交付流程与版本策略

**状态**：已确认  
**日期**：2026-05-26  
**参与者**：Chanler, Codex

## 决策

Scorel 使用面向 AI 开发的三段式交付流程：

```text
idea/discussion → S#### spec → ship
```

- 讨论沉淀到 `self/discussions/`。
- 确认后的工作单元写成 `docs/spec/ship/S####-*.md`。
- Roadmap 不提前占用未来 S 编号；只有准备实现或范围已确认时才创建 S spec。
- 实现 PR 只按一个 S spec 交付。
- `docs/SHIP.md` 是 AI 执行前必须读取的交付协议。

版本策略：

- 所有 `@scorel/*` packages 与 apps 使用同一个版本号。
- 默认 bump 为 patch。
- minor / major 只有用户明确指定时才执行。
- `protocolVersion` 是 wire protocol 兼容号，与 npm/package version 分离。

## 背景

Scorel 适合 AI 开发，但前提是把上下文切成稳定、可验证、可恢复的单元。直接让 AI 按 milestone 或大段 roadmap 实现，会导致范围膨胀、上下文污染、测试遗漏。

参考 `scorel-init` / `scorel-idea` / `scorel-ship` 三个 skill 后，保留其核心思想：

- init：建立项目交付协议。
- idea：把想法变成 spec。
- ship：按 spec 实现并验证。

但不照搬其目录结构。Scorel 已有 `self/` 协作记录、`docs/spec/ship/S####` 编号 spec、ADR 体系，因此要适配现有文档系统。

## 工作流

### 1. Discussion

任何未确认方向先记录到：

```text
self/discussions/YYYY-MM-DD-topic.md
```

讨论记录可以包含探索、取舍、风险和开放问题，不作为实现合同。

### 2. Spec

确认后的工作写成：

```text
docs/spec/ship/S####-slug.md
```

S spec 必须包含：

- 目标
- 范围
- 不做什么
- 验收标准
- 测试要求
- 影响文件 / 包
- 风险与边界

Roadmap 只描述产品阶段目标，不负责提前拆完所有 future specs。

### 3. Ship

实现时只做当前 S spec。发现延伸能力时，只追加 Roadmap 或新 spec，不混进当前 PR。

提交和 PR title：

```text
S####: <type>: <description>
```

## Versioning

### Package version

Scorel 使用 fixed version / locked-step release。所有 packages 和 apps 同版本：

```text
@scorel/protocol 0.0.1
@scorel/core     0.0.1
@scorel/daemon   0.0.1
@scorel/client   0.0.1
@scorel/cli      0.0.1
```

理由：

- protocol、daemon、client 强耦合。
- 独立版本会产生兼容矩阵，增加 AI 实现和测试复杂度。
- 早期业务价值在端到端能力，不在单包独立发布。

### Bump policy

| Bump | 触发 |
|---|---|
| patch | 默认。普通 spec、bug fix、refactor、内部协议演进 |
| minor | 用户明确指定；通常对应 milestone 级能力开放 |
| major | 用户明确指定；`1.0.0` 前不自动 major |

初始版本为 `0.0.0`。第一次发布为 `0.0.1`。

### Protocol compatibility

Wire protocol 单独维护兼容号：

```typescript
export const protocolVersion = 1;
```

Daemon/client 握手时检查 `protocolVersion`。只有 wire message 不兼容时才增加，不随每次 package patch 增加。

## 否决方案

### 每个 package 独立版本

看似灵活，但会让 `@scorel/client@x` 支持哪些 `@scorel/daemon@y` 成为持续负担。早期不值得。

### Roadmap 直接驱动实现

Milestone 太粗，AI 容易扩范围。Roadmap 只负责目标，执行必须落到 S spec。

### 自动 minor

自动按 feature 做 minor 会过快膨胀版本号。用户已确认默认 patch，minor/major 手动触发。
