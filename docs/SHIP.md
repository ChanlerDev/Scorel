# Scorel Ship Protocol

> 给 AI 和人类工程师的交付入口。实现前先读本文件，再读 Roadmap、目标 S spec、相关抽象 spec 和 ADR。

---

## Source Of Truth

读取顺序：

1. `docs/architecture.md` — 系统分层、包边界、数据流。
2. `docs/decisions/*.md` — 已锁定的架构决策。
3. `docs/ROADMAP.md` — 产品阶段目标。
4. `docs/spec/*.md` — 抽象规约。
5. `docs/spec/ship/*.md` — 当前 active S spec。
6. `self/` — 协作讨论、取舍过程、未正式锁定的上下文。

`docs/IMPLEMENTATION_PROMPT.md` 和旧实现不作为 source of truth。

---

## Check

当前一键验证：

```bash
pnpm typecheck && pnpm test
```

涉及 `scorel chat` 真实产品路径的 spec，还必须补一条手工 smoke：用真实 LLM provider、真实临时工作区和真实 JSONL session 验证端到端行为。不能用 mock/fake provider 作为完成证明。

后续可以收敛成 `pnpm check` 或 `node scripts/check.mjs`，但 SHIP 里记录的命令必须始终可直接执行。

---

## Ship Loop

### 1. Idea

新想法先讨论，不直接写代码。讨论记录放入：

```text
self/discussions/YYYY-MM-DD-topic.md
```

确认为方向后，写成编号 spec：

```text
docs/spec/ship/S####-slug.md
```

### 2. Spec

每个 S spec 是实现合同，必须包含：

- 目标
- 范围
- 不做什么
- 验收标准
- 测试要求
- 影响文件 / 包
- 风险与边界

没有 S spec，不开始实现。Bug fix 也需要 S spec，可以很短。

### 3. Ship

实现一个 S spec 时：

1. 只读当前 spec 相关上下文。
2. 先写失败测试或类型约束。
3. 做最小实现。
4. 运行精确测试。
5. 运行全量 check。
6. 更新必要文档。
7. 提交时使用 S 编号。

实现中发现延伸能力，不混入当前 spec；写入 Roadmap 或新 S spec。

---

## Commit And PR

格式：

```text
S####: <type>: <description>
```

`type`：

- `feat`
- `fix`
- `refactor`
- `perf`
- `chore`
- `docs`
- `test`

规则：

- 一个 PR 对应一个 S spec。
- Commit message 使用 title-only semantic commit：只写标题，不写正文。
- 按业务含义拆 commit，不把无关实现混在一起。
- 文档、实现、测试可以拆 commit，但 PR title 必须带 S 编号。
- 首个 docs baseline 已完成；后续提交只按当前 S spec 收敛范围。

---

## Version

Scorel 使用统一版本号：所有 `@scorel/*` package 与 apps 同步版本发布。

默认版本 bump：

- `patch`：默认。所有普通 spec、bug fix、refactor、内部协议演进都走 patch。
- `minor`：只有用户明确指定，通常用于 milestone 级能力开放。
- `major`：只有用户明确指定。`1.0.0` 前原则上不自动 major。

初始版本：

```text
0.0.0
```

第一次 release：

```text
0.0.1
```

Wire protocol 另有兼容版本：

```text
protocolVersion: 1
```

`protocolVersion` 只在 daemon/client 握手不兼容时增加。package version 和 protocolVersion 不混用。

---

## Release

发布前置条件：

- working tree clean
- 当前分支不是 detached HEAD
- 目标 S spec 已完成并可验证
- check 通过
- version bump 默认为 patch，除非用户明确指定 minor / major

推荐命令形态：

```bash
pnpm release patch
pnpm release minor
pnpm release major
```

正式 release 脚本后续实现，职责包括：

- 检查 working tree
- 执行 check
- bump 所有 package version
- 更新 changelog
- commit `release: vX.Y.Z`
- tag `vX.Y.Z`
- push branch + tag

---

## Branch

默认分支前缀遵循当前 Codex 工作约定：

```text
codex/S####-slug
```

如果用户明确要求其他前缀，以用户要求为准。

---

## Documentation Sync

- 架构边界变化 → `docs/architecture.md` + `docs/decisions/ADR`
- 模块接口变化 → 对应 `docs/spec/*.md`
- 新工作单元 → `docs/spec/ship/S####-*.md`（只在准备实现或范围已确认时创建）
- 计划变化 → `docs/ROADMAP.md`
- 配置 schema / provider 接入变化 → `docs/spec/extensions.md` + 当前 S spec
- 讨论和取舍 → `self/discussions/`
- 决策锁定 → `self/decisions/` + 必要时同步 `docs/decisions/`

探索性笔记不混进 ADR；未确认方向不写成正式决策。
