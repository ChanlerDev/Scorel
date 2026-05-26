# Scorel 文档

> Scorel 是构建在 pi-ai 之上的应用层 AI Agent 编排平台。
> 核心能力：对话资产化、多端实时同步、扩展生态。

---

## 快速导航

| 想了解 | 读 |
|--------|-----|
| 整体架构、分层、数据流 | [`architecture.md`](architecture.md) |
| AI 交付协议、check、release、版本规则 | [`SHIP.md`](SHIP.md) |
| 阶段目标与 active specs | [`ROADMAP.md`](ROADMAP.md) |
| 事件模型（PersistentEvent + TransientEvent） | [`spec/events.md`](spec/events.md) |
| Runtime 执行引擎、persist 策略、双队列 | [`spec/runtime.md`](spec/runtime.md) |
| Daemon 层、协议、transport、同步、并发 | [`spec/daemon.md`](spec/daemon.md) |
| DaemonClient SDK、Client 侧接口 | [`spec/client.md`](spec/client.md) |
| Session 存储、JSONL、树、Rewind、压缩 | [`spec/session.md`](spec/session.md) |
| 工具系统、内置工具、MCP | [`spec/tools.md`](spec/tools.md) |
| Hooks、Extensions、System Prompt、配置 | [`spec/extensions.md`](spec/extensions.md) |
| Channel 适配器（IM / cron） | [`spec/channels.md`](spec/channels.md) |

## 决策记录

| ADR | 决策 |
|-----|------|
| [`001`](decisions/001-dual-provider.md) | 底层 API/CLI 两套体系，上层统一 Agent 接口 |
| [`002`](decisions/002-daemon-layer.md) | 统一 Daemon 层：三种 Transport，多 client 广播 |
| [`003`](decisions/003-event-runtime.md) | 事件运行时行为：persist 策略、同步算法、双队列 |
| [`004`](decisions/004-package-boundaries.md) | Protocol / Core / Daemon / Client 包边界 |
| [`005`](decisions/005-ai-delivery-versioning.md) | AI 交付流程与版本策略 |

## 文档层次

```
architecture.md        ← 鸟瞰：系统长什么样、为什么这样（很少改）
SHIP.md                ← AI / human 交付协议：check、ship、version、release
ROADMAP.md             ← Milestone + active S specs
spec/*.md              ← 抽象规约：模块接口级定义（精简，偶尔小改）
spec/ship/S####-*.md    ← 编号 spec：具体 feature/优化的设计（完成后只增不改）
decisions/             ← ADR：为什么选 A 不选 B（只增不改）
```

---

## 文档演进策略

### 三层文档

| 层 | 示例 | 修改频率 | 规则 |
|----|------|---------|------|
| 抽象规约 | `spec/daemon.md` | 偶尔 | 接口级定义，保持精简。结构性变化时小改 |
| 编号 spec | `spec/ship/S0001-session-tree.md` | Active 可改；完成后只增不改 | 每个 feature/优化一篇，实现完即定稿 |
| ADR | `decisions/003-event-runtime.md` | 只增不改 | 纯决策记录 |

### 编号 spec 命名规则

```
S{4位数字}-{短横线分隔标题}.md

示例：
spec/ship/S0001-session-tree.md
spec/ship/S0002-runtime-bridge.md
spec/ship/S0123-compact-auto.md
spec/ship/S0124-compact-trigger-optimization.md   ← 对 S0123 的优化
```

- 前缀 `S` + 4 位数字（S0001 ~ S9999）
- 示例编号不代表 Roadmap 承诺，真实编号只在准备实现时创建
- 完成后只增不改：后续优化 = 新编号（引用前序 spec）
- 代码是当前状态 source of truth，编号 spec 是演进历史

### Commit 与 PR 规范

**所有改动都挂 spec 编号**。无论 feature、bug fix、refactor、chore。

```
# PR title / Squash commit message 格式
S{编号}: {type}: {描述}

# type 列表
feat     — 新功能
fix      — bug 修复
refactor — 重构（不改行为）
perf     — 性能优化
chore    — 构建/工具/配置
docs     — 文档改动
test     — 测试
```

示例：
```
S0002: feat: create package skeleton
S0123: feat: implement session tree and JSONL v1 store
S0124: fix: buildContext skips compact events incorrectly
S0125: refactor: extract EventTypeHandler registry
S0126: perf: compact trigger optimization for long sessions
```

- 每个 PR 对应一个 spec 编号
- spec 文档内容量按实际需要：feature 可能 200 行，bug fix 可能只有 10 行描述问题 + 修复方案
- 大 spec 可拆多个 PR：`S0123 [1/3]: daemon skeleton`
- Squash merge 后 commit message = PR title

### 规则总结

1. **抽象 spec 不膨胀** — 它只是入口/总览，细节在编号 spec 里
2. **编号 spec 完成后只增不改** — active / planned spec 可在实现前收口，Done 后定稿
3. **后续优化 = 新编号** — 引用前序 spec 说明改了什么
4. **Roadmap 不预占未来 spec** — 到阶段前再拆 `S####`
5. **代码 = source of truth** — 文档描述设计意图和演进理由，不是代码注释的替代
6. **Commit 标 spec 编号** — 可追溯每次改动对应哪个设计
