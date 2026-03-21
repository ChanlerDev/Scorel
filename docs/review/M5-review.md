# M5 Release — Implementation Review

> Reviewer: Claude | Commits: `fbdc586` (packaging pipeline) + `fdd1bcb` (first-run setup & polish) | 163 tests passing

## R1 — Retracted (False Positives)

初版 review 报告了 21 个问题，其中 16 个在逐文件人工复核后确认为**误报**——实现代码已正确处理，review agent 未仔细读代码就从设计文档推断出了不存在的 bug。

以下已验证为**实现正确**，不需修复：

| # | 原报告 | 实际代码 | 结论 |
|---|--------|---------|------|
| 1 | ChatInput Enter 键逻辑错误 | `ChatInput.tsx:25`: `(e.metaKey \|\| e.ctrlKey)` — 仅 Cmd+Enter 发送 | ✅ 正确 |
| 2 | ErrorBoundary 用 `window.location.reload()` | `error-boundary.tsx:30`: `handleReset` 调用 `setState({ hasError: false, error: null })` | ✅ 正确 |
| 3 | SetupWizard 在连接测试前存 API key | `setup-wizard.tsx:111-128`: 先 `testConnection`，成功后才 `upsert` + `secrets.store`，失败有清理 | ✅ 正确 |
| 4 | `app.exit(0)` 跳过 Electron 生命周期 | `index.ts:178`: 使用 `app.quit()`，不是 `app.exit(0)` | ✅ 正确 |
| 5 | `shutdownRunner` timeout reject | `orchestrator.ts:502-506`: timeout 分支调用 `resolve()`，并在 `finally` 清理 timer | ✅ 正确 |
| 6 | 改名后孤儿 provider | `setup-wizard.tsx:130-134`: 检测 `previousProviderId !== config.id` 后删除旧 provider + secret | ✅ 正确 |
| 7 | `notarize.js` 无 try/catch | `notarize.js:19-30`: 有 try/catch，错误 re-throw | ✅ 正确 |
| 8 | Maximized 窗口保存全屏 bounds | `index.ts:41-47`: `getNextWindowState` 在 maximized 时保留 `previousState` 的 bounds | ✅ 正确 |
| 9 | menu.ts 闭包持有 mainWindow 值 | `menu.ts:3`: 签名为 `getMainWindow: () => BrowserWindow \| null`，传入函数引用 | ✅ 正确 |
| 10 | optimistic 消息 ID 不回收 | `useChat.ts:200`: `finally` 块调用 `loadMessages(sessionId)` 从 DB 重载完整消息列表 | ✅ 正确 |
| 11 | 删除后自动选中第一个 session | `App.tsx:108`: `shouldAutoSelectFirstSessionRef.current` 在 `handleSessionMutated` 中设为 `false` | ✅ 正确 |
| 12 | Anthropic baseUrl `/v1` 重复路径 | `anthropic-adapter.ts:55`: `${baseUrl}/messages` → `/v1/messages` 正确；`buildHealthcheckUrl` 也正确处理 | ✅ 正确 |
| 13 | 初始 theme IPC 事件丢失 | `index.ts:138-140`: `did-finish-load` 触发 `sendThemeToRenderer`；`use-theme.ts:14` 还有 `app.getTheme()` 拉取兜底 | ✅ 正确 |
| 14 | window-state 只检查左上角 | `window-state.ts:28-47`: 使用 `getOverlap` 计算像素重叠，要求至少 `MIN_VISIBLE_EDGE=80px` 双轴重叠 | ✅ 正确 |
| 15 | ChatView 硬编码 `#555` | `ChatView.tsx:181`: 已改为 `var(--text-secondary)` | ✅ 正确 |
| 18 | build.ts finally 掩盖退出码 | `build.ts:11-32`: 单独捕获 buildError，rebuild 失败时优先 throw 原始 buildError | ✅ 正确 |

---

## R2 — Confirmed Issues

经逐文件复核后，仅以下 5 个问题确认存在：

| # | Priority | Area | Issue | Status |
|---|----------|------|-------|--------|
| 1 | P2 | build.ts | 使用 CJS `require()` 不符合项目 TypeScript 规范 | **Fixed** — 改为 ESM `import` |
| 2 | P2 | electron-builder | 缺少 `icon` 字段和 `build/icon.icns` 文件 | **Fixed** — 增加 `mac.icon` 字段 + 占位图标 |
| 3 | P2 | ProviderSetup.tsx | 死代码 — 不再被任何模块引用 | **Fixed** — 已删除 |
| 4 | P3 | electron-builder | pnpm `.pnpm/` 符号链接布局可能影响 better-sqlite3 asarUnpack | **Verified** — `pnpm pack:unsigned` 成功，`.node` 在 `app.asar.unpacked/` 中 |
| 5 | P3 | package.json | `lint` 脚本 `--ext` 标志在 ESLint 9 中已移除 | **Fixed** — 此前已修复 |

### #1 — `scripts/build.ts` 使用 CJS `require()`

**File**: `scripts/build.ts:1`

```ts
const { execSync } = require("node:child_process");
```

项目全量使用 TypeScript ESM `import`。此文件通过 `node --experimental-strip-types` 执行，`require()` 在 CJS 模式下可工作但不符合约定。设计文档 §3.4 也使用 `import`。

**Fix**:

```ts
import { execSync } from "node:child_process";
```

同时确保执行方式兼容 ESM（可能需要 `tsx` 替代 `--experimental-strip-types`，或在 `scripts/` 下配置独立 tsconfig）。

---

### #2 — `electron-builder.yml` 缺少 icon 字段

**File**: `electron-builder.yml`

设计文档 §3.1 在 `mac:` 下指定了 `icon: build/icon.icns`。当前配置完全省略此字段，且 `build/icon.icns` 文件不存在。DMG 会使用 Electron 默认图标。

**建议**：即使图标文件尚未就绪，也应在 config 中声明字段。这样当图标文件到位后构建自动生效，缺失时也会明确报错而非静默使用默认图标。

```yaml
mac:
  icon: build/icon.icns   # TODO: 替换为正式图标
```

---

### #3 — `ProviderSetup.tsx` 已成死代码

**File**: `src/renderer/components/ProviderSetup.tsx`

M5 将首次配置流程从 `ProviderSetup` 迁移到了 `SetupWizard`。`App.tsx` 已改为导入 `setup-wizard`。但旧的 `ProviderSetup.tsx`（132 行）仍保留在 `src/renderer/components/` 中，全项目无任何 import 引用。

**Fix**: 删除 `src/renderer/components/ProviderSetup.tsx`。

---

### #4 — pnpm 符号链接布局可能影响 asarUnpack

**File**: `electron-builder.yml:20-21`

```yaml
asarUnpack:
  - dist/runner/**
  - node_modules/better-sqlite3/**
```

pnpm 的 content-addressable 布局将真实文件放在 `node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/` 下。electron-builder 通常通过依赖遍历正确解析，但这是一个已知的 pnpm + electron-builder 交互点，需要通过实际 `pnpm pack:unsigned` 构建来验证。

**验证方式**:

```bash
pnpm pack:unsigned
# 然后检查：
npx asar list release/mac-universal/Scorel.app/Contents/Resources/app.asar | grep better-sqlite3
# 确认 .node 文件在 app.asar.unpacked/ 而非 app.asar 中
```

---

### #5 — ESLint 9 `--ext` 标志（pre-existing）

**File**: `package.json:15`

```json
"lint": "eslint src runner tests vite.config.ts vitest.config.ts --ext .ts,.tsx"
```

ESLint 9 flat config（`57cefd5` 迁移）移除了 `--ext` 标志。运行 `pnpm lint` 会报错 `unknown option '--ext'`。此问题在 M5 之前就存在，非 M5 引入，但在此记录。

**Fix**: 移除 `--ext .ts,.tsx`，ESLint 9 flat config 通过配置文件中的 `files` glob 控制文件匹配。

---

## 总体评价

Droid 的 M5 实现质量很高。32 个文件变更，2128 行新增，163 个测试全部通过。

**做得好的地方**：

- **安全意识**：连接测试成功后才持久化 API key，失败有回滚清理（`setup-wizard.tsx:117-134`）
- **生命周期正确性**：`app.quit()` 而非 `app.exit()`；`shutdownRunner` timeout 用 resolve 而非 reject；`did-finish-load` 后才推送 theme
- **防御性编程**：`getNextWindowState` 在 maximized 时保留旧 bounds；`isVisibleOnAnyDisplay` 用像素重叠而非角点检测；`shouldAutoSelectFirstSessionRef` 防止删除后误选
- **架构设计**：`buildAppMenu(getMainWindow)` 传函数引用与 `ipc-handlers.ts` 模式一致；`testConnection` 接受 `(config, apiKey)` 内联参数避免预注册
- **测试覆盖**：shutdown timeout、abortAll idle skip、whitespace validation、maximized off-screen、full menu structure 均已覆盖

5 个确认问题中 3 个是 P2（规范/清理），2 个是 P3（需验证/pre-existing），无 P0/P1。
