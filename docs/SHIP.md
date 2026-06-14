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

`docs/IMPLEMENTATION_PROMPT.md` 和旧实现不作为 source of truth。

`self/` 只用于本机探索性草稿，不纳入 Git handoff，也不得成为实现所需上下文。确认后的结论必须同步到 `docs/`。

---

## Quickstart

```bash
pnpm install
pnpm scorel       # 在当前目录进入交互式项目会话
```

Hosted WebUI 路径：

```bash
pnpm scorel host serve
open https://scorel.chanler.dev
pnpm scorel pair <pair-code>
```

`scorel host serve` 会以前台调试模式启动本机 Host、注册当前目录为初始 Project，并默认连接官方 Relay；前台 Host 默认一直存活，直到 Ctrl+C / SIGTERM，除非显式传入 `--idle-timeout-ms`。`scorel host start` 会启动或复用后台 singleton Host，并返回到 shell；直接后台启动的 CLI Host 默认一直存活，直到 `scorel host stop` 或进程退出。`scorel up` / `pnpm dev` 只作为本地开发便利入口：确保后台 Host 可用，然后启动本地 WebUI，但不拥有 Host 生命周期。GUI / CUI 自动拉起的后台 Host 无 client、无 active work、无 active IM 时会按 15 分钟 idle timeout 自动退出；active IM 会保持 Host 存活。

---

## Check

当前一键验证：

```bash
pnpm typecheck && pnpm test
```

默认验证原则：

- 走真实、统一、通用的产品路径。
- 不用 mock/fake provider 作为完成证明。
- 不为测试添加隐藏分支、特殊协议、特殊 transport 或只在测试里存在的产品行为。
- 临时目录、临时端口、真实本地进程、真实 JSONL session 属于可接受的真实资源；mock/fake 和为测试绕过产品路径不接受，除非用户明确要求。

涉及 `scorel chat` 真实产品路径的 spec，还必须补一条手工端到端验证：用真实 LLM provider、真实临时工作区和真实 JSONL session 验证端到端行为。不能用 mock/fake provider 作为完成证明。

后续可以收敛成 `pnpm check` 或 `node scripts/check.mjs`，但 SHIP 里记录的命令必须始终可直接执行。

---

## Development Stage Rule

Scorel 当前仍处于 pre-1.0 开发阶段。除非某个 spec 明确要求兼容，否则默认规则是：

- 优先选择长期正确、边界清晰的架构，不为未发布的旧实现保留兼容层。
- 可以删除旧命令、旧 schema、旧 transport、旧缓存和旧本地状态文件。
- 不添加 deprecated alias、双写逻辑、自动迁移器或 fallback 分支来延长错误抽象。
- 发生 wire protocol 不兼容变更时，直接更新 protocol 类型、调用方、测试和 `protocolVersion`。
- 发生本地状态不兼容变更时，在 spec 中写清楚需要删除或重建的 `~/.scorel` 工件。

这条规则不代表可以无说明地破坏用户数据。Session JSONL 是否保留、重建或删除，必须由当前 spec 显式决定。

---

## Ship Loop

### 1. Idea

新想法先讨论，不直接写代码。本机可选草稿位置：

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
pnpm release patch --dry-run
pnpm release patch
pnpm release minor
pnpm release major
pnpm release patch --no-generate-notes
```

正式 release 脚本职责包括：

- 检查 working tree
- 执行 check
- 执行 WebUI production build
- 构建 public `scorel` npm package
- 执行 `npm pack` 安装烟雾测试
- bump 所有 package version
- 默认用 DeepSeek V4 Flash 从上一个 `v*` tag 之后的 commits 生成 changelog notes
- 更新 changelog；只有显式 `--no-generate-notes` 时才写入最小版本标题
- commit `release: vX.Y.Z`
- tag `vX.Y.Z`
- publish root `scorel` package to npm
- push branch + tag
- create GitHub Release from the same generated changelog notes
- upload the same-version `npm pack` tarball as the only GitHub Release asset

Release notes 使用 `DEEPSEEK_API_KEY` 调用 DeepSeek 官方 API，默认 endpoint 为 `https://api.deepseek.com/v1`，默认模型为 `deepseek-v4-flash`。Dry-run 在缺少 key 或 API 失败时可打印 deterministic fallback preview；正式 release 默认要求 AI notes 成功，除非显式传入 `--no-generate-notes`。

GitHub Actions 提供手动触发入口，默认执行 `patch` dry-run。正式 release 使用 `GITHUB_TOKEN` 创建 GitHub Release；正式 publish 需要仓库 secret `NPM_TOKEN`，对应 npm 账号当前为 `chanlerdev`。AI release notes 需要仓库 secret `DEEPSEEK_API_KEY`。

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
- 讨论和取舍 → 可选本机草稿 `self/discussions/`
- 决策锁定 → 必须同步 `docs/decisions/`

探索性笔记不混进 ADR；未确认方向不写成正式决策。任何需要跨机器继续开发的上下文都必须写入 Git 跟踪的 `docs/`。
