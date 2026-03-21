# M5 Release — 设计与技术文档

> 状态：待实现 | 基于 V0-M5 spec

## 1. 目标

在 M1–M4 完成 streaming、tool execution、history & search、compact & skills 的基础上，将 Scorel 打包为可分发的 macOS 应用：

1. **构建与分发**：electron-builder 打包 DMG + ZIP，代码签名 + 公证确保 Gatekeeper 放行
2. **首次运行体验**：多步引导向导替代当前的单一 ProviderSetup 界面，覆盖 provider 选型 → 配置 → 连接测试 → workspace 选择完整流程
3. **生产级打磨**：Error Boundary、loading states、键盘快捷键、暗色模式、窗口状态持久化、优雅关闭

目标用户画像：非开发者下载 DMG → 安装 → 配置 provider → 完成一次完整的代码助手会话（含 tool use）。

## 2. 现状盘点

### 已就绪（可直接使用）

| 组件 | 位置 | 说明 |
|------|------|------|
| `electron-builder` | `package.json` devDeps | v25.1.8 已安装，但未配置 |
| `electron` v33.2.0 | `package.json` devDeps | 主进程运行正常 |
| `vite` v6 + React 19 | `vite.config.ts` | renderer 构建流水线就绪 |
| `contextIsolation + sandbox` | `src/main/index.ts:56-59` | 安全基线已满足 |
| `ProviderSetup.tsx` | `src/renderer/components/` | 单步 OpenAI 配置表单，需重构为多步向导 |
| `providers:testConnection` IPC | `preload/index.ts:54` | 连接测试端点已就绪 |
| `ScorelBridge` 全量类型 | `src/renderer/global.d.ts` | preload bridge 类型完整 |
| `Api` 联合类型含 `anthropic-messages` | `shared/types.ts:6` | 双 provider 类型已定义 |
| `anthropicAdapter` | `src/main/provider/anthropic-adapter.ts` | Anthropic 适配器已实现 |
| `buildProviderMap()` 支持双 API | `src/main/index.ts:79-98` | 根据 `config.api` 动态选择 adapter |

### 待实现

| 组件 | 说明 |
|------|------|
| `electron-builder.yml` | 构建配置：targets、签名、公证 |
| `scripts/notarize.js` | afterSign hook，调用 Apple notary service |
| `scripts/build.ts` | 统一构建脚本：tsc + vite + electron-builder |
| `SetupWizard.tsx` | 多步首次运行向导（替代 ProviderSetup） |
| `ErrorBoundary.tsx` | React Error Boundary 组件 |
| 暗色模式 CSS + theme IPC | 跟随系统主题偏好 |
| 键盘快捷键注册 | Cmd+N / Cmd+Enter / Escape |
| 窗口状态持久化 | 保存/恢复窗口位置和大小 |
| 优雅关闭逻辑 | 等待 in-flight 操作完成后退出 |

## 3. 模块设计

### 3.1 electron-builder 配置 — `electron-builder.yml`

electron-builder 使用独立 YAML 配置文件，与 package.json 解耦。

```yaml
appId: com.scorel.app
productName: Scorel
copyright: Copyright © 2025–2026 Scorel

directories:
  output: release
  buildResources: build   # 图标等静态资源

files:
  - dist/**/*             # tsc + vite 产物
  - node_modules/**/*     # native modules (better-sqlite3)
  - package.json
  - "!src"                # 排除源码
  - "!tests"
  - "!docs"

# asar 打包 — better-sqlite3 的 .node binary 必须解包
asar: true
asarUnpack:
  - "node_modules/better-sqlite3/**"

mac:
  target:
    - target: dmg
      arch: [universal]   # x64 + arm64 fat binary
    - target: zip
      arch: [universal]
  category: public.app-category.developer-tools
  icon: build/icon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist

dmg:
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications
  window:
    width: 540
    height: 380

afterSign: scripts/notarize.js
```

**Entitlements**（`build/entitlements.mac.plist`）— Hardened Runtime 所需的最小权限：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- Electron 需要 JIT 和 unsigned executable memory -->
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <!-- 网络：provider API 调用 -->
  <key>com.apple.security.network.client</key>
  <true/>
  <!-- 文件访问：workspace 读写 -->
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
</dict>
</plist>
```

**构建产物结构**：

```
release/
  Scorel-0.1.0-universal.dmg     # 主分发物
  Scorel-0.1.0-universal-mac.zip # auto-updater 用 (optional)
  latest-mac.yml                  # auto-updater 元数据 (optional)
```

### 3.2 代码签名 — Code Signing

签名由 electron-builder 自动处理，前提是环境变量正确配置。

**CI 环境变量**：

| 变量 | 用途 |
|------|------|
| `CSC_LINK` | base64 编码的 .p12 证书（Developer ID Application） |
| `CSC_KEY_PASSWORD` | 证书密码 |
| `APPLE_ID` | Apple ID 邮箱（公证用） |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password（公证用） |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

**本地开发构建**：设置 `CSC_IDENTITY_AUTO_DISCOVERY=false` 跳过签名，生成未签名的 .app 供本地测试。

**签名验证命令**：

```bash
# 验证签名有效性
codesign --verify --deep --strict release/mac-universal/Scorel.app

# 查看签名详情
codesign -dv --verbose=4 release/mac-universal/Scorel.app

# 验证公证 staple
spctl --assess --type execute release/mac-universal/Scorel.app
```

### 3.3 公证 — `scripts/notarize.js`

electron-builder 的 `afterSign` hook 在签名完成后自动调用公证流程。

```ts
// scripts/notarize.js
const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // 仅 macOS 需要公证；CI 环境才执行
  if (electronPlatformName !== "darwin") return;
  if (!process.env.APPLE_ID) {
    console.log("Skipping notarization: APPLE_ID not set");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath}...`);

  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log("Notarization complete");
};
```

**公证流程时序**：

```
electron-builder sign
  → afterSign hook 触发
    → @electron/notarize 上传 .app 到 Apple
    → Apple 服务端扫描 (通常 1–5 分钟)
    → 返回成功 → notarize lib 自动 staple
  → electron-builder 继续生成 DMG
```

**依赖**：需要安装 `@electron/notarize`：

```bash
pnpm add -D @electron/notarize
```

### 3.4 构建脚本 — `scripts/build.ts`

统一构建入口，串联所有步骤：

```ts
// scripts/build.ts — 用 tsx 或 ts-node 执行
import { execSync } from "node:child_process";

const run = (cmd: string) => execSync(cmd, { stdio: "inherit" });

// Step 1: TypeScript 编译
console.log("==> Compiling TypeScript...");
run("pnpm build");

// Step 2: Vite 打包 renderer
console.log("==> Bundling renderer...");
run("pnpm build:renderer");

// Step 3: electron-builder 打包
console.log("==> Packaging with electron-builder...");
run("npx electron-builder --config electron-builder.yml");

console.log("==> Done. Artifacts in release/");
```

**package.json 新增 scripts**：

```json
{
  "scripts": {
    "pack": "tsx scripts/build.ts",
    "pack:unsigned": "CSC_IDENTITY_AUTO_DISCOVERY=false tsx scripts/build.ts"
  }
}
```

### 3.5 Auto-updater — 可选，V0 预留

V0 将 auto-updater 标记为可选。如果实现，使用 `electron-updater` + GitHub Releases：

```ts
// src/main/updater.ts — V0 可选实现
import { autoUpdater } from "electron-updater";
import { BrowserWindow } from "electron";

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  autoUpdater.autoDownload = false; // 用户确认后才下载
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    mainWindow.webContents.send("updater:available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow.webContents.send("updater:progress", {
      percent: progress.percent,
    });
  });

  autoUpdater.on("update-downloaded", () => {
    mainWindow.webContents.send("updater:ready");
  });

  // 启动时检查一次
  autoUpdater.checkForUpdates().catch(() => {
    // 静默失败 — 网络不可用等情况
  });
}
```

**决策**：V0 暂不实现 auto-updater。electron-builder 的 ZIP + `latest-mac.yml` 会自动生成，为 V1 预留。类型和 IPC 端点不预注册。

### 3.6 首次运行向导 — `SetupWizard.tsx`

当前 `ProviderSetup.tsx` 仅支持 OpenAI 单一配置，不支持 Anthropic 也没有 workspace 选择。M5 替换为多步向导。

**向导步骤状态机**：

```
Welcome → SelectProvider → ConfigureProvider → TestConnection → SelectWorkspace → Done
  (0)         (1)               (2)                (3)              (4)          (5)
```

**类型定义**：

```ts
type WizardStep =
  | "welcome"
  | "select-provider"
  | "configure"
  | "test-connection"
  | "select-workspace"
  | "done";

type ProviderPreset = {
  id: string;
  displayName: string;
  api: Api;
  baseUrl: string;
  auth: { type: "bearer" | "x-api-key" };
  defaultModel: string;
  placeholder: string;      // API key placeholder hint
};

// 内置预设
const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    api: "openai-chat-completions",
    baseUrl: "https://api.openai.com/v1",
    auth: { type: "bearer" },
    defaultModel: "gpt-4o",
    placeholder: "sk-...",
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    auth: { type: "x-api-key" },
    defaultModel: "claude-sonnet-4-20250514",
    placeholder: "sk-ant-...",
  },
  // "Custom (OpenAI-compatible)" 使用 openai-chat-completions + 用户自定义 baseUrl
];
```

**各步骤职责**：

| 步骤 | 组件 | 职责 |
|------|------|------|
| Welcome | `WizardWelcome` | 品牌 Logo + 简介 + "Get Started" 按钮 |
| SelectProvider | `WizardProviderSelect` | 三选一：OpenAI / Anthropic / Custom |
| Configure | `WizardConfigure` | 根据选择填充 baseUrl、model、API key |
| TestConnection | `WizardTestConnection` | 调用 `providers.testConnection()`，显示结果 |
| SelectWorkspace | `WizardWorkspace` | 调用 `dialog.showOpenDialog` 选择文件夹 |
| Done | `WizardDone` | 配置摘要 + "Start Chatting" 按钮 |

**Workspace 选择 — IPC 新增端点**：

当前 preload bridge 没有目录选择能力。需新增：

```ts
// preload/index.ts 新增
app: {
  selectDirectory: () => ipcRenderer.invoke("app:selectDirectory"),
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
},
```

```ts
// main/ipc-handlers.ts 新增
ipcMain.handle("app:selectDirectory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Select Workspace Folder",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("app:getVersion", () => app.getVersion());
```

**Provider 配置检测**（App 启动时判断是否需要向导）：

```ts
// App.tsx 启动逻辑改造
const [appState, setAppState] = useState<"loading" | "setup" | "ready">("loading");

useEffect(() => {
  window.scorel.providers.list().then((providers) => {
    if (providers.length === 0) {
      setAppState("setup");    // 无 provider → 显示向导
    } else {
      // 使用第一个 provider 的配置
      setProviderId(providers[0].id);
      setModelId(providers[0].models[0]?.id ?? null);
      setAppState("ready");
    }
  });
}, []);
```

### 3.7 Error Boundary — `ErrorBoundary.tsx`

React class component（函数组件不支持 `componentDidCatch`）。

```ts
type ErrorBoundaryProps = {
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};
```

**布局策略**：两层 boundary，隔离 sidebar 和 main area 的崩溃：

```
<App>
  <ErrorBoundary region="sidebar">
    <Sidebar />
  </ErrorBoundary>
  <ErrorBoundary region="main">
    <ChatView />
  </ErrorBoundary>
</App>
```

**Fallback UI**：显示错误信息 + "Reload" 按钮（调用 `setState({ hasError: false })` 重置）。生产构建中不显示 stack trace。

### 3.8 Loading States

需要覆盖的加载场景：

| 场景 | 位置 | 指示器类型 |
|------|------|-----------|
| 消息 streaming 中 | `ChatView` 底部 | 脉动点动画 + "Thinking..." |
| Tool 执行中 | `MessageList` tool_call 行 | Spinner + tool name |
| Tool 等待审批 | `MessageList` tool_call 行 | 黄色图标 + "Awaiting approval" |
| Compact 执行中 | `ChatView` 顶栏 | 进度条 + "Compacting..." |
| Session 加载 | `ChatView` 主区域 | 骨架屏 placeholder |
| Provider 连接测试 | `SetupWizard` | Spinner + "Testing..." |

**实现方式**：不引入动画库，使用 CSS `@keyframes` + 内联样式。与现有 inline style 模式保持一致。

### 3.9 键盘快捷键

**两层注册**：

1. **Electron Menu accelerators**（全局，Menu 可见时生效）：
   - `Cmd+N` → 新建 session
   - `Cmd+,` → 打开设置 / provider 管理（V0 简化为重新配置）
   - `Cmd+W` → 关闭窗口

2. **Renderer local shortcuts**（React 层 `useEffect` + `keydown`）：
   - `Cmd+Enter` → 发送消息（ChatInput 已有发送逻辑，加快捷键绑定）
   - `Escape` → 中止 streaming（调用 `chat.abort()`）

**Electron Menu 模板**（`src/main/menu.ts`）：

```ts
import { app, Menu, BrowserWindow } from "electron";

export function buildAppMenu(mainWindow: BrowserWindow): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Chat",
          accelerator: "CmdOrCtrl+N",
          click: () => mainWindow.webContents.send("menu:new-session"),
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
```

**Preload 新增 menu 事件监听**：

```ts
// preload/index.ts 新增
menu: {
  onNewSession: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("menu:new-session", listener);
    return () => ipcRenderer.removeListener("menu:new-session", listener);
  },
},
```

### 3.10 暗色模式 — Dark Mode

**策略**：跟随系统偏好，使用 CSS custom properties 实现主题切换。

**Main 进程 — 主题变更通知**：

```ts
// src/main/index.ts 补充
import { nativeTheme } from "electron";

// 初始主题
mainWindow.webContents.send("theme:changed", nativeTheme.shouldUseDarkColors ? "dark" : "light");

// 监听系统主题变化
nativeTheme.on("updated", () => {
  mainWindow?.webContents.send(
    "theme:changed",
    nativeTheme.shouldUseDarkColors ? "dark" : "light",
  );
});
```

**Renderer — CSS custom properties**：

```css
/* src/renderer/theme.css */
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-tertiary: #e0e0e0;
  --text-primary: #1a1a1a;
  --text-secondary: #555555;
  --text-muted: #999999;
  --border: #e0e0e0;
  --accent: #007aff;
  --accent-hover: #0066d6;
  --error: #ff3b30;
  --success: #34c759;
  --shadow: rgba(0, 0, 0, 0.1);
}

:root[data-theme="dark"] {
  --bg-primary: #1e1e1e;
  --bg-secondary: #252525;
  --bg-tertiary: #333333;
  --text-primary: #e0e0e0;
  --text-secondary: #aaaaaa;
  --text-muted: #666666;
  --border: #3a3a3a;
  --accent: #0a84ff;
  --accent-hover: #409cff;
  --error: #ff453a;
  --success: #30d158;
  --shadow: rgba(0, 0, 0, 0.3);
}
```

**Renderer — 主题应用 hook**：

```ts
// src/renderer/hooks/useTheme.ts
export function useTheme(): void {
  useEffect(() => {
    // 初始值：CSS media query
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");

    // 监听 main 进程的通知（更可靠，macOS nativeTheme 驱动）
    const cleanup = window.scorel.app.onThemeChanged((theme: string) => {
      document.documentElement.setAttribute("data-theme", theme);
    });

    return cleanup;
  }, []);
}
```

**迁移路径**：现有组件使用内联 `style={{ background: "#fff" }}` 硬编码颜色。M5 需要将颜色值替换为 `var(--bg-primary)` 等变量。由于 React 内联 style 不支持 CSS variables（需 `style={{ background: "var(--bg-primary)" }}`，语法有效），可以逐步迁移。

### 3.11 窗口状态持久化

**不引入外部库**，手动实现（逻辑简单，代码量少于 50 行）：

```ts
// src/main/window-state.ts
import { screen } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

type WindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
};

const DEFAULT_STATE: WindowState = {
  x: 0, y: 0,
  width: 1200, height: 800,
  isMaximized: false,
};

export function loadWindowState(userDataPath: string): WindowState {
  const filePath = path.join(userDataPath, "window-state.json");
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const state: WindowState = JSON.parse(raw);

    // 验证窗口位置是否在某个显示器的可见范围内
    const displays = screen.getAllDisplays();
    const visible = displays.some((d) =>
      state.x >= d.bounds.x &&
      state.y >= d.bounds.y &&
      state.x < d.bounds.x + d.bounds.width &&
      state.y < d.bounds.y + d.bounds.height
    );

    return visible ? state : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveWindowState(
  userDataPath: string,
  state: WindowState,
): void {
  const filePath = path.join(userDataPath, "window-state.json");
  fs.writeFileSync(filePath, JSON.stringify(state), "utf-8");
}
```

**集成到 main/index.ts**：

```ts
const windowState = loadWindowState(userDataPath);

mainWindow = new BrowserWindow({
  x: windowState.x,
  y: windowState.y,
  width: windowState.width,
  height: windowState.height,
  // ...其他配置
});

if (windowState.isMaximized) mainWindow.maximize();

// 窗口移动/缩放时保存状态（debounce）
let saveTimer: NodeJS.Timeout | null = null;
const persistBounds = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!mainWindow) return;
    const bounds = mainWindow.getBounds();
    saveWindowState(userDataPath, {
      ...bounds,
      isMaximized: mainWindow.isMaximized(),
    });
  }, 500);
};

mainWindow.on("resize", persistBounds);
mainWindow.on("move", persistBounds);
mainWindow.on("maximize", persistBounds);
mainWindow.on("unmaximize", persistBounds);
```

### 3.12 优雅关闭 — Graceful Shutdown

**问题**：用户关闭窗口时，可能有进行中的 streaming 或 tool execution。需要确保：

1. 正在进行的 LLM streaming 被 abort
2. Runner 子进程被正常终止
3. SQLite 数据库连接正常关闭（WAL checkpoint）
4. 事件日志写完最后一个 flush

**实现**：

```ts
// src/main/index.ts — before-quit handler
app.on("before-quit", async (event) => {
  if (shuttingDown) return;
  shuttingDown = true;
  event.preventDefault();

  console.log("Graceful shutdown: aborting active sessions...");

  try {
    // 1. 中止所有活跃 session 的 streaming
    orchestrator.abortAll();

    // 2. 等待 runner 进程退出 (timeout 3s)
    await orchestrator.shutdownRunner(3000);

    // 3. 关闭数据库
    db.close();

    console.log("Graceful shutdown complete");
  } catch (err) {
    console.error("Shutdown error:", err);
  } finally {
    app.quit();
  }
});
```

**Orchestrator 新增方法**：

```ts
/** 中止所有活跃 session 的 streaming/tool execution */
abortAll(): void

/** 关闭 runner 进程，超时后强制 kill */
async shutdownRunner(timeoutMs: number): Promise<void>
```

## 4. 集成改造

### 4.1 `src/main/index.ts`

- 引入 `buildAppMenu()` 并 `Menu.setApplicationMenu()`
- 引入 `loadWindowState` / `saveWindowState`，替换硬编码的 width/height
- 引入 `nativeTheme` 监听，发送 `theme:changed` 事件
- 添加 `before-quit` graceful shutdown handler
- 注册 `app:selectDirectory` 和 `app:getVersion` IPC handler

### 4.2 `src/preload/index.ts`

新增 bridge 方法：

```ts
app: {
  selectDirectory: () => ipcRenderer.invoke("app:selectDirectory"),
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  onThemeChanged: (callback: (theme: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, theme: string) =>
      callback(theme);
    ipcRenderer.on("theme:changed", listener);
    return () => ipcRenderer.removeListener("theme:changed", listener);
  },
},
menu: {
  onNewSession: (callback: () => void) => {
    ipcRenderer.on("menu:new-session", () => callback());
    return () => ipcRenderer.removeAllListeners("menu:new-session");
  },
},
```

### 4.3 `src/renderer/global.d.ts`

扩展 `ScorelBridge` 类型：

```ts
app: {
  selectDirectory(): Promise<string | null>;
  getVersion(): Promise<string>;
  onThemeChanged(callback: (theme: string) => void): () => void;
};
menu: {
  onNewSession(callback: () => void): () => void;
};
```

### 4.4 `src/renderer/App.tsx`

- 启动时检测 provider 是否已配置（`providers.list()`），决定显示 SetupWizard 还是主界面
- 用 `ErrorBoundary` 包裹 sidebar 和 main area
- 引入 `useTheme()` hook
- 监听 `menu:onNewSession` 事件触发新建 session
- Cmd+Enter / Escape 快捷键通过 props 或 context 传递到 ChatInput

### 4.5 现有组件颜色迁移

将 `ChatView.tsx`、`MessageList.tsx`、`ChatInput.tsx`、`App.tsx` 中的硬编码颜色值替换为 CSS variable 引用。示例：

```diff
- background: "#f5f5f5"
+ background: "var(--bg-secondary)"
```

## 5. 数据流

### 5.1 构建 + 签名 + 公证流程

```
pnpm pack
  │
  ├─ tsc -p tsconfig.main.json       → dist/main/
  ├─ tsc -p tsconfig.preload.json    → dist/preload/
  ├─ tsc -p tsconfig.renderer.json   → (类型检查)
  ├─ vite build                      → dist/renderer/
  │
  └─ electron-builder --config electron-builder.yml
       │
       ├─ 打包 dist/ + node_modules → Scorel.app
       ├─ asar 压缩 (better-sqlite3 .node 解包)
       │
       ├─ [CI] codesign --deep --force --sign "Developer ID Application: ..."
       │   └─ Hardened Runtime + entitlements
       │
       ├─ [CI] afterSign → scripts/notarize.js
       │   ├─ @electron/notarize 上传到 Apple
       │   ├─ Apple 审查 (1-5 min)
       │   └─ staple 回写到 .app
       │
       └─ 生成 DMG + ZIP → release/
```

### 5.2 首次运行向导流程

```
App 启动
  │
  ├─ providers.list() → []  (空)
  │   └─ 显示 SetupWizard
  │       ├─ Step 0: Welcome
  │       ├─ Step 1: 选择 OpenAI / Anthropic / Custom
  │       ├─ Step 2: 填写 baseUrl, model, apiKey
  │       │   └─ 预设自动填充 (baseUrl, defaultModel, placeholder)
  │       ├─ Step 3: providers.upsert(config) + secrets.store(id, key)
  │       │   └─ providers.testConnection(id) → { ok, error }
  │       │       ├─ ok → 继续
  │       │       └─ error → 显示错误，允许返回修改
  │       ├─ Step 4: app.selectDirectory() → workspaceRoot
  │       └─ Step 5: sessions.create({ providerId, modelId, workspaceRoot })
  │           └─ 进入主界面 (App state → "ready")
  │
  └─ providers.list() → [config, ...]  (非空)
      └─ 直接进入主界面
```

### 5.3 暗色模式切换流程

```
macOS System Preferences → 切换 Appearance
  │
  └─ nativeTheme.on("updated")
       │
       └─ mainWindow.webContents.send("theme:changed", "dark" | "light")
            │
            └─ renderer useTheme() hook
                 │
                 └─ document.documentElement.setAttribute("data-theme", theme)
                      │
                      └─ CSS :root[data-theme="dark"] 生效
                           └─ var(--bg-primary) 等变量切换
```

### 5.4 优雅关闭流程

```
用户点击关闭 / Cmd+Q
  │
  └─ app.on("before-quit")
       │
       ├─ orchestrator.abortAll()
       │   └─ 所有活跃 session: abort streaming + cancel pending tool
       │
       ├─ orchestrator.shutdownRunner(3000)
       │   ├─ runner.stdin.end()  → 通知 runner 退出
       │   ├─ 等待 runner exit (最多 3s)
       │   └─ 超时 → runner.kill("SIGTERM")
       │
       ├─ db.close()
       │   └─ WAL checkpoint + 释放文件锁
       │
       └─ app.quit()
```

## 6. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `electron-builder.yml` | 新建 | electron-builder 构建配置 |
| `build/entitlements.mac.plist` | 新建 | Hardened Runtime 权限声明 |
| `build/icon.icns` | 新建 | macOS 应用图标 (1024×1024) |
| `scripts/notarize.js` | 新建 | afterSign 公证脚本 |
| `scripts/build.ts` | 新建 | 统一构建入口脚本 |
| `src/main/menu.ts` | 新建 | Electron Menu 模板 + 快捷键 |
| `src/main/window-state.ts` | 新建 | 窗口位置/大小持久化 |
| `src/renderer/theme.css` | 新建 | CSS custom properties 主题变量 |
| `src/renderer/hooks/useTheme.ts` | 新建 | 暗色模式 hook |
| `src/renderer/components/SetupWizard.tsx` | 新建 | 多步首次运行向导 |
| `src/renderer/components/ErrorBoundary.tsx` | 新建 | React Error Boundary |
| `src/main/index.ts` | 修改 | Menu、window-state、theme、graceful shutdown 集成 |
| `src/main/ipc-handlers.ts` | 修改 | 新增 `app:selectDirectory`、`app:getVersion` |
| `src/main/core/orchestrator.ts` | 修改 | 新增 `abortAll()`、`shutdownRunner()` |
| `src/preload/index.ts` | 修改 | 新增 `app`、`menu` bridge |
| `src/renderer/global.d.ts` | 修改 | 扩展 `ScorelBridge` 类型 |
| `src/renderer/App.tsx` | 修改 | provider 检测、ErrorBoundary 包裹、useTheme、menu 事件 |
| `src/renderer/components/ChatView.tsx` | 修改 | loading states、颜色变量迁移 |
| `src/renderer/components/MessageList.tsx` | 修改 | tool 状态指示器、颜色变量迁移 |
| `src/renderer/components/ChatInput.tsx` | 修改 | Cmd+Enter 快捷键、颜色变量迁移 |
| `package.json` | 修改 | 新增 `pack`/`pack:unsigned` scripts、`@electron/notarize` 依赖 |

## 7. 测试策略

### 7.1 单元测试

| 文件 | 覆盖 |
|------|------|
| `tests/unit/window-state.test.ts` | `loadWindowState`：正常加载、文件缺失、JSON 损坏、窗口超出屏幕 |
| `tests/unit/setup-wizard.test.ts` | 向导步骤切换、preset 填充、输入验证、错误处理 |
| `tests/unit/error-boundary.test.ts` | 子组件抛错时渲染 fallback、reset 恢复正常渲染 |
| `tests/unit/menu.test.ts` | `buildAppMenu` 返回正确的 menu 模板结构 |

### 7.2 集成测试

| 文件 | 覆盖 |
|------|------|
| `tests/integration/first-run.test.ts` | 无 provider → 显示向导 → 配置 → 测试 → workspace → 进入主界面 |
| `tests/integration/graceful-shutdown.test.ts` | 模拟 before-quit → abort → runner shutdown → db close |

### 7.3 E2E 测试（Playwright）

| 场景 | 验证 |
|------|------|
| 首次启动 | 向导显示 → 配置 provider → 选择 workspace → 创建 session |
| 完整闭环 | 配置 → 聊天 → tool round → search → compact → export → 重启 → resume |
| 暗色模式 | 切换系统主题 → UI 颜色变更 |
| 键盘快捷键 | Cmd+N 创建 session、Cmd+Enter 发送、Escape 中止 |

### 7.4 手动验收测试

| 测试项 | 方法 |
|------|------|
| DMG 安装 | 在 clean macOS 上双击 DMG → 拖入 Applications → 启动无 Gatekeeper 警告 |
| 签名验证 | `codesign --verify --deep --strict` 返回成功 |
| 公证验证 | `spctl --assess --type execute` 返回 "accepted" |
| 首次运行 | 全新安装 → 自动显示向导 → 完成配置 |
| 重启恢复 | 配置 provider → 退出 → 再次启动 → 跳过向导直接进入主界面 |

## 8. 性能考量

### 8.1 asar 与 native modules

`better-sqlite3` 包含 C++ addon（`.node` 文件），必须通过 `asarUnpack` 解包。否则 Electron 无法在 asar 归档中加载 native module。解包后文件位于 `app.asar.unpacked/node_modules/better-sqlite3/`。

### 8.2 Universal Binary 体积

macOS universal binary（x64 + arm64）的 .app 体积约为单架构的 1.8–2x。对于 Scorel（Electron + SQLite），预计：
- 单架构 DMG：~120–150 MB
- Universal DMG：~200–250 MB

如果体积成为问题，可改为分架构构建（`arch: [x64, arm64]` 替代 `arch: [universal]`）。

### 8.3 首次启动冷启动时间

Electron 冷启动（macOS）通常 1–3 秒。优化点：
- `BrowserWindow` 的 `show: false` + `ready-to-show` 事件 → 避免白屏闪烁
- 向导/主界面判断在 renderer 侧完成（providers.list 走 IPC），不阻塞窗口显示

## 9. Spec 偏差

| 偏差 | Spec 要求 | 实际方案 | 理由 |
|------|----------|---------|------|
| Auto-updater | "optional" | V0 不实现 | 增加构建复杂度 + 需要 GitHub Release 基础设施；DMG 分发已满足 V0 需求 |
| 构建脚本 | "Webpack/Vite bundle renderer" | 仅 Vite | 项目从 M1 起就只用 Vite，不引入 Webpack |
| ProviderSetup 复用 | Spec 列为"Create" | 重构现有 ProviderSetup → 作为 SetupWizard 的 Configure 步骤子组件 | 避免代码重复 |
| 暗色模式实现 | "follow system preference" | CSS custom properties + nativeTheme IPC | 无需 CSS-in-JS 库；内联 style 通过 `var()` 引用 |

## 10. 已知限制

1. **Auto-updater 未实现**：V0 用户需手动下载新版本 DMG 覆盖安装。V1 实现 electron-updater。
2. **仅 macOS**：electron-builder 配置仅包含 mac target。Windows/Linux 支持留给 V1。
3. **无 CI/CD pipeline**：本文档定义构建脚本和环境变量，但不包含 GitHub Actions workflow。CI 配置属于基础设施，V0 手动执行。
4. **图标占位**：`build/icon.icns` 需要设计师提供正式图标。开发阶段使用 Electron 默认图标或临时占位。
5. **暗色模式迁移不完整**：现有组件大量使用硬编码颜色的内联 style。完全迁移到 CSS variables 是增量工作，M5 优先覆盖主要界面（App、ChatView、Sidebar），次要细节可后续补全。
6. **首次运行仅单 provider**：向导引导配置一个 provider。多 provider 管理（切换、删除）通过现有 ProviderSetup 入口，M5 不新增管理界面。
7. **Workspace 默认路径**：向导强制用户选择 workspace 目录。不提供"默认 home 目录"选项（符合安全规范：workspace 必须显式选择）。

## 11. 实施顺序建议

M5 的各子模块依赖较少，可以高度并行。建议分三个阶段：

**Phase 1 — 构建基础（可独立）**

1. `electron-builder.yml` + `build/entitlements.mac.plist`
2. `scripts/notarize.js`
3. `scripts/build.ts` + package.json scripts
4. 验证：`pnpm pack:unsigned` 生成可运行的 .app

**Phase 2 — UI 打磨（可并行）**

5. `theme.css` + `useTheme` hook + 颜色变量迁移
6. `ErrorBoundary.tsx` + App.tsx 包裹
7. `menu.ts` + 快捷键注册
8. Loading states（ChatView、MessageList）
9. `window-state.ts` + main/index.ts 集成

**Phase 3 — 首次运行 + 收尾**

10. `SetupWizard.tsx`（依赖 theme.css 生效后的视觉一致性）
11. `app:selectDirectory` IPC + preload bridge
12. App.tsx 启动逻辑改造（provider 检测 → 向导/主界面分流）
13. Graceful shutdown
14. E2E 测试 + 手动验收
