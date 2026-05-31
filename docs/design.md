# Scorel Design Philosophy

> WebUI 视觉与交互的单一真相源。任何 UI 变更先读本文件,与之冲突的写法走 ADR 推翻或 spec 显式记录例外。

---

## 1. 哲学(抄 ChatGPT)

**少即克制,克制即专业。**

- 信息层级靠**字号/字重/留白**,不靠色块、阴影、渐变。
- 颜色只服务两件事:**可读性**(文字/边)与**单一强调**(send / active session)。
- 任何"加点东西看看"的冲动先驳回;先证明缺,再加。
- "未实装"不藏不删,**保留位置 + 灰掉**,做产品诚实度信号(Codex 风)。
- 暗色模式只是配色翻转,布局/圆角/间距/字号完全保持。

参考:ChatGPT Web 当前设计语言、Chatbox app 三段式 sidebar、Codex 灰按钮语义。

---

## 2. 视觉 Tokens(锁定值)

### 2.1 颜色

```
--color-bg:           #FFFFFF   /* 主区背景 */
--color-surface:      #F7F7F8   /* sidebar / 浮层底色,比 bg 深一档 */
--color-surface-hover:#EFEFF1   /* hover 反馈 */
--color-border:       #E7EAEC   /* 唯一 1px 边色 */
--color-border-strong:#9CA3AF   /* focus 状态边 */
--color-text:         #0D0D0D   /* 正文 */
--color-text-muted:   #5D5D5D   /* 副文本 / 时间戳 */
--color-text-faint:   #9CA3AF   /* placeholder / disabled */
--color-accent:       #0D0D0D   /* send 按钮黑底 */
--color-accent-soft:  #F4F4F4   /* user 气泡底 */
--color-status-ok:    #16A34A
--color-status-warn:  #D97706
--color-status-err:   #DC2626
--color-status-idle:  #9CA3AF
```

**禁止**:任何 Tailwind 字面量灰阶(zinc/slate/stone/neutral/gray)、任何渐变、任何 shadow(focus 也不用)。

### 2.2 字体栈

```
--font-body: -apple-system, BlinkMacSystemFont, "PingFang SC",
             "Segoe UI", "Helvetica Neue", system-ui, sans-serif;
--font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
```

**移除**:Newsreader / Charter / 任何 serif。所有 H1~H6、标题、正文、sidebar、composer 全 sans。

### 2.3 字号阶梯(锁五档,无中间值)

```
--text-xs:    12px / line-height 1.4   /* 时间戳, sidebar 分组标题 uppercase */
--text-sm:    13px / line-height 1.5   /* sidebar 行 */
--text-base:  14px / line-height 1.5   /* UI chrome */
--text-md:    16px / line-height 1.6   /* 对话正文 */
--text-lg:    20px / line-height 1.3   /* 段落标题(markdown h2/h3) */
--text-xl:    30px / line-height 1.2   /* 空态欢迎语(markdown h1) */
```

### 2.4 间距 / 圆角

```
--space-1:  4px
--space-2:  8px
--space-3:  12px
--space-4:  16px
--space-5:  20px
--space-6:  24px
--space-8:  32px

--radius-sm:  6px    /* hover 块 */
--radius-md:  12px   /* 卡片 / icon 按钮 */
--radius-lg:  16px   /* user 气泡 */
--radius-pill: 24px  /* composer */
--radius-full: 9999px /* 圆形 send / icon 按钮 */
```

### 2.5 阴影

```
全局禁用 box-shadow。
需要层级时用 surface 底色(--color-surface)制造分层。
focus 状态改边框颜色到 --color-border-strong,不弹 ring。
```

---

## 3. 布局结构

### 3.1 整体

```
┌─────────────┬──────────────────────────────┐
│             │                              │
│  Sidebar    │     Main (无 topbar)         │
│  280px      │                              │
│  surface    │     bg                       │
│             │                              │
│             │     Transcript               │
│             │                              │
│             │     ┌──────────────────────┐ │
│             │     │  Composer (pill)     │ │
│             │     └──────────────────────┘ │
└─────────────┴──────────────────────────────┘
```

**主区无 topbar**。标题靠对话第一条用户消息回填(空态显欢迎语)。

### 3.2 Sidebar(三段式)

```
┌─ Sidebar (280px, surface) ──────┐
│                                 │
│  + 新对话         [active]      │  顶部固定操作 4 行(36px 高)
│  🔍 搜索          [灰]          │
│  🧩 插件          [灰]          │
│  🤖 自动化         [灰]          │
│                                 │
│  ─────────────                  │  (无 divider,靠 24px 间距分块)
│  设备                            │  分组标题 12px uppercase muted
│                                 │
│  ▾ Local                        │  Device 节点,▾/▸ 折叠
│      ▾ Scorel                   │  Project 节点,▾/▸ 折叠
│        · session A              │
│        · session B  [active]    │  active = 左 2px accent + soft 底
│      ▸ Tickel                   │  折叠态,sessions 不渲染
│  ▸ Remote-1 (offline)           │
│                                 │
│                                 │
│  ─ 底部固定 ─                    │
│  ⚙ Settings                     │
│  ☀ 主题切换       [灰]          │
└─────────────────────────────────┘
```

折叠状态(每 project / device 独立)持久化到 `localStorage["scorel.ui.collapsed"]`。

### 3.3 Composer(pill)

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  Message Scorel...                               │  textarea,无边框,placeholder #9CA3AF
│                                                  │
│  ⊕ [灰]                          GPT-4 ▾ [灰] 🎤 [灰] ●  │
└──────────────────────────────────────────────────┘
   ↑ 圆角 24px, border 1px #E7EAEC,无 shadow
   focus 时边变 #0D0D0D,无 outline 动画
```

- 左 `⊕`:附件/工具入口(灰按钮占位)
- 右 model picker `GPT-4 ▾`:显示当前 model,**灰按钮**(本轮不可切换)
- 右 `🎤`:麦克风(灰按钮占位)
- 右 `●` send:28px 圆,bg=accent(黑),focus/active 时显白箭头;inFlight 时变红 cancel(status-err)

### 3.4 对话气泡

```
                                            ┌────────────┐
                                            │  你好      │   user: accent-soft 底
                                            │            │   max-width 70%
                                            └────────────┘   靠右,圆角 16px

assistant 直接贴 bg,无气泡,无头像,无名字
左对齐,行宽同 prose,与正文同 16px

工具调用块走 markdown json fence(已存在)
```

消息间距 24px。无分割线。无时间戳常驻(hover 整条消息时浮现 12px muted)。

---

## 4. 交互

### 4.1 灰按钮(disabled UI)

```css
.btn[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;  /* 不弹 hover 反馈 */
}
```

不显示 tooltip。"未实装"= 视觉信号即可,不打扰。

### 4.2 Hover

唯一 hover 反馈 = `bg: var(--color-surface-hover)`,无颜色变化、无 transform、无 shadow。

### 4.3 Focus

- Composer focus:边框变 `--color-text`(黑)。
- 链接 focus:加一档 underline。
- 按钮 focus:`outline: 2px solid var(--color-text); outline-offset: 2px;`(无圆角弯折)。

### 4.4 折叠

- Project / Device 节点 click prefix `▸/▾` 切换,纯文字符,不引 chevron icon 库。
- 状态 localStorage 持久化,key=`scorel.ui.collapsed`,value=`{[id]: boolean}`。

---

## 5. 排版规则

### 5.1 字重

- 正文 `400`,sidebar 行 `400`,active session `500`,标题 `600`。
- 不用 `700+`(过重不符极简)。

### 5.2 行高

正文 1.6 / sidebar 1.4 / 标题 1.2 / 代码 1.5。固定。

### 5.3 字号使用

- H1(空态欢迎):`--text-xl` 30px。
- 段落标题(markdown h2/h3):`--text-lg` 20px。
- 对话正文 / 输入框:`--text-md` 16px。
- UI chrome / 按钮文字:`--text-base` 14px。
- Sidebar session 行:`--text-sm` 13px。
- 时间戳 / 分组标题:`--text-xs` 12px。

不允许其他值。

---

## 6. 暗色模式(后置)

token 全部走 CSS var,future spec 只翻配色,不动布局。占位:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg:           #212121;
    --color-surface:      #171717;
    /* ... */
  }
}
```

本轮不实装,主题切换按钮灰掉。

---

## 7. 与 M5.5 的关系

M5.5(暖纸 + 墨蓝 + Newsreader serif) **被本设计哲学整体推翻**。

历史决策见 `self/discussions/2026-05-31-webui-polish-brainstorm.md` §5.5。本文档作为新基线,后续 spec 引用本文件,不引用 M5.5 决策表。

---

## 8. 引用

- ChatGPT web(chatgpt.com)— 设计哲学与排版。
- Chatbox app(chatboxai.app) — 三段式 sidebar 结构与 pill composer。
- Codex(github.com/openai/codex) — 灰按钮语义、密度。
