# Scorel UI 设计体系

> Scorel UI 设计的单一真相源。修改 GUI 或 WebUI 前先读本文件；如果某个 spec 需要打破这里的规则，必须在 spec 中说明原因，或先更新本文档。

Scorel 是一个面向项目型工作的 AI Agent 工作台。UI 应该安静、密集、稳定，适合用户长期反复使用。Codex 是重要参考，但 Scorel 不是 Codex 皮肤。设计判断必须服务 Scorel 自己的产品模型：Project 上下文、可恢复 Session、本机控制、显式选择远程 Project，以及可审计的 agent 工作过程。

---

## 1. 产品原则

### 1.1 Project first

Project 是用户的主要工作上下文。Device、Relay、Host 拓扑是支撑元数据，只有在用户管理连接时才应该成为主角。

- GUI sidebar 以 Project 为第一层工作入口。
- 远程 Project 只有在用户显式选择后才进入 GUI Project list。
- Settings 可以解释 Device 和 Relay，但 GUI 主导航不应退回 Device-first。
- WebUI 作为浏览器控制远程 Host 的入口时，可以保持 Device-first。

### 1.2 真实能力优先

用户看见的命令必须对应真实产品路径。

- 看起来可点击但没有实现的命令应该隐藏。
- 不因为参考产品有某个入口，就保留一个空壳占位。
- disabled control 只用于真实能力的暂不可用状态，或解释当前状态。
- 非交互 status chip 可以保留，但必须真实说明当前状态，例如访问模式、运行状态、远程在线状态。

### 1.3 安静但高密度

Scorel 是工作台，不是 landing page。

- 优先使用紧凑行、清楚标签、稳定位置。
- 信息层级先靠字号、字重、留白解决，再考虑装饰。
- 避免营销式 hero、过大卡片、装饰性渐变、空 feature panel。
- 重复使用的工作表面要稳定：sidebar、transcript、composer、picker、settings 不应因内容变化频繁跳动。

### 1.4 Agent 工作可读可审计

Agent 输出不是聊天装饰，而是产品数据。

- tool call、文件读取、编辑、diff、shell output、Todo 状态都需要明确视觉合同。
- assistant prose 应该直接可读，不依赖头像或厚重气泡。
- user message 可以有区分，但不能压过工作内容。
- code 和 diff 表面必须支持扫描、比较和发现错误。

---

## 2. Surface 模型

### 2.1 Desktop GUI

GUI 是本机桌面工作台。

- Electron main process 拥有 local Host lifecycle 和 Node-only integration。
- Renderer 是 Entry UI，不写 JSONL，不复制 Host domain logic。
- macOS glass / source-list 效果可以用于 sidebar 和 settings nav。
- Relay Device 是连接来源；远程 Project 必须由用户显式加入后才进入工作区。

### 2.2 WebUI

WebUI 是浏览器里的控制面。

- 当用户通过浏览器控制某个 Host 时，WebUI 可以是 Device-first。
- WebUI 仍应遵守共享的排版、间距、真实能力、agent 输出可读性规则。
- WebUI 不需要复制 GUI 的桌面玻璃效果或窗口 chrome。

---

## 3. 信息架构

### 3.1 Sidebar / source list

用途：导航和工作上下文。

- 使用紧凑 source-list 布局。
- 顶层命令要少，并且必须已实现。
- Project 拥有自己的 Session 子列表。
- active row 使用克制背景和稳定字重，不使用强烈强调色。
- online/offline 是辅助元数据，只在帮助选择远程 Project 或诊断连接时显示。

### 3.2 Workspace

用途：当前 Project 和 Session 的工作区。

- 空态询问用户要在当前 Project 中做什么。
- Session view 以 transcript 和 composer 为中心。
- 避免 topbar 重复 sidebar 或 context pill 已经表达的信息。
- Session title 和 action menu 只有在控制当前 Session 时才常驻。

### 3.3 Composer

用途：主要指令输入。

- composer 在 focus、send、streaming 过程中保持稳定。
- Project 选择器放在影响新 Session 落点的位置，通常靠近 composer。
- Send / Cancel 是真实命令，需要清晰强 affordance。
- attachment、microphone、model、permission 这类控件未实现前，不应作为可用命令出现。

### 3.4 Project picker

用途：选择或添加工作 Project。

- picker 跟随触发它的控件打开。
- Project 数量会增长时，需要搜索。
- Add Local Project 和 Add Remote Project 是有效入口，因为它们有真实产品路径。
- GUI 默认没有 null-project / 不使用项目模式；除非未来 spec 改变 Project-first 模型。

### 3.5 Settings

用途：管理真实本地 app 状态、连接和安全偏好。

- Settings 不默认复制参考产品分类。
- 只有 Scorel 有真实可管理表面时，才建立对应分类。
- Relay pairing 和 authorized Devices 是真实 settings。
- Appearance 可以作为安全偏好入口，但完整 token system 不等于用户主题编辑器。

### 3.6 Tool output

用途：让 agent 工作过程可审计。

- tool chip 用于行内摘要。
- 展开 block 显示可验证细节，但避免淹没 transcript。
- code / diff output 必须保持 monospace 对齐、行边界和颜色语义稳定。
- error state 必须有文字说明，不能只靠颜色表达。

---

## 4. Visual tokens

Token 名称描述角色，不描述偶然颜色。

### 4.1 Color roles

必须具备的角色：

```text
--color-bg              main workspace background
--color-window          desktop window fallback background
--color-sidebar         source-list glass/tint surface
--color-surface         neutral grouped surface
--color-surface-soft    quieter nested surface
--color-surface-hover   hover and selected-row fill
--color-surface-raised  cards, popovers, grouped controls
--color-border          default border
--color-border-hairline subtle separators
--color-border-strong   focus or active separation
--color-text            primary text
--color-text-muted      secondary text
--color-text-faint      placeholder and low-emphasis text
--color-accent          primary command
--color-accent-on       text/icon on primary command
--color-code            code block background
--color-link            links
--color-status-ok       success / online
--color-status-warn     warning / attention
--color-status-err      error / destructive
--color-status-idle     idle / unavailable
```

GUI 专属角色：

```text
--color-sidebar-border  glass/source-list edge highlight
--color-sidebar-shadow  subtle source-list separation
```

### 4.2 Typography

UI 和 prose 使用系统 sans；code、terminal、diff 使用 monospace。

```text
--font-body
--font-mono
```

字号阶梯保持小而工作台化：

```text
--text-xs    metadata, timestamps, captions
--text-sm    sidebar/session rows, compact controls
--text-base  standard UI
--text-md    prose and composer input
--text-lg    settings/card headings
--text-xl    empty-state headline
--text-hero  only for true first-screen empty state
```

不要用 viewport width 动态缩放字号。

### 4.3 Spacing and radius

使用小间距体系，保证控件尺寸稳定。

```text
--space-1
--space-2
--space-3
--space-4
--space-5
--space-6
--space-8

--radius-sm
--radius-md
--radius-lg
--radius-card
--radius-pill
--radius-full
```

card 只用于 grouped settings、repeated items、popover、modal。不要把装饰 card 套在 card 里面。

### 4.4 Border, elevation, glass

- 默认使用 1px border 和 hairline separator。
- shadow 只在 popover、modal、desktop source-list 分离时克制使用。
- GUI sidebar 可以使用透明背景、vibrancy、backdrop blur 和细微边缘高光。
- WebUI 不应伪造厚重桌面玻璃层。

### 4.5 Motion

动效服务方向感，不做品牌装饰。

- 避免装饰性 animation。
- focus 和 active state 反馈要即时。
- 新增 transition 时遵守 reduced-motion preference。

### 4.6 Code and diff tokens

Scorel 需要明确 code / diff 语义：

```text
--color-diff-add-bg
--color-diff-add-border
--color-diff-remove-bg
--color-diff-remove-border
--color-diff-hunk-bg
--color-code-line-number
--color-code-selection
```

add/remove 在浅色和深色主题下都必须清楚，不能只依赖红绿颜色。

---

## 5. Component contracts

### 5.1 Source-list row

- 固定行高。
- icon、label、可选 metadata、可选 status。
- hover 只改变 surface。
- active state 克制、可读。
- 文本按规则截断，不撑开布局。

### 5.2 Project/session tree

- Project row 拥有自己的 Session children。
- Project display name 是主信息。
- Remote Device label 只在消歧时作为 secondary metadata。
- Session title 来自持久 summary，保持紧凑可恢复。

### 5.3 Composer

- 多行 text input。
- footer/action area 稳定。
- Send/Cancel affordance 清楚。
- Project context 保持 compact。
- 除非设计明确要求，不给整个 composer shell 加额外外圈 focus ring。

### 5.4 Project picker

- trigger-anchored popover。
- search input。
- Project list 标记当前选择。
- add actions 只放已实现的 local / remote 路径。
- 除非从居中 empty-state 触发，否则 picker 不应浮在页面中央。

### 5.5 Settings row/card

- Settings page 使用 grouped rows。
- label 和 description 在左，control 在右。
- control 必须已实现，或清楚读作 read-only。
- 不放未接线的 fake link，例如不可用的 open config。

### 5.6 Modal

- 只用于打断式聚焦任务，例如添加远程 Project。
- 包含 title、短说明、form body、footer actions。
- 点击外部关闭只适用于没有重要未保存状态的场景。

### 5.7 Tool chip/block

- Chip：紧凑 action summary。
- Block：可展开细节、code、diff、shell output、Todo state。
- Pending、success、error、cancelled 状态必须视觉可分，并且有文字可读。

---

## 6. Appearance boundary

Appearance 默认不是换肤编辑器。

可以作为用户偏好开放的安全子集：

- theme mode: system / light / dark
- reduced motion: system / on / off
- font smoothing: system / on / off，只有平台需要时再做
- UI / code font size，只有可访问性证据需要时再做

没有后续 spec 前，不开放：

- custom accent color
- arbitrary background / foreground colors
- token import/export
- theme copying
- contrast slider
- custom font family persistence
- full theme editor

这些能力会创建长期持久化和支持合同。它们以后可以成为 internal design lab 或 developer mode，但不应在视觉基线未稳定前进入默认产品设置。

---

## 7. References

- Codex App：密度、source-list 行为、project workbench 感、克制 Settings。
- ChatGPT：克制、prose 可读性、干净 composition。
- macOS Settings：桌面 source-list settings 结构和 grouped rows。

参考只帮助判断，不覆盖 Scorel 的产品模型。
