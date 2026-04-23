# d002 — Channel：外部输入的统一入口

> 上游：`d000-architecture.md`
> 主题：把 CLI 输入、HTTP 请求、IM 消息、cron 触发都归一为"向 Agent 注入一条 `AgentMessage`"。

---

## 1. 设计目标

真实使用场景里，用户和 Agent 的对话入口从来不止一个——命令行、浏览器、IM 机器人、定时任务都可能想让它工作。如果每个入口都自带一套语义和状态，Session 资产化的前提（同一份 JSONL、同一个 replay 函数）就无法成立。

Channel 的设计目标是：**无论消息从哪里来，进入 Agent 的姿势永远一样**。

这里没有"Channel 协议"这种大词，只有一个很窄的接口和一条统一的注入路径。

---

## 2. ChannelAdapter 接口

```typescript
interface ChannelAdapter {
  readonly id: string;                       // 'cli' | 'http' | 'telegram' | 'cron'
  start(inject: MessageInjector): Promise<void>;
  stop(): Promise<void>;
}

type MessageInjector = (msg: AgentMessage) => Promise<void>;
```

Channel 只负责两件事：
1. 从外部源接收消息
2. 调 `inject(msg)` 把它扔进 Agent

它 **不** 关心 Agent 是否在运行、是否要等回复——这些由核心统一处理。

---

## 3. Injector：空闲 vs 运行中

```typescript
function createInjector(agent: Agent): MessageInjector {
  return async (msg) => {
    if (agent.state.isStreaming) {
      agent.steer(msg);        // 正在跑：入队等下一个 turn 结束
    } else {
      await agent.prompt(msg); // 空闲：直接唤醒
    }
  };
}
```

这是 Channel 归一的核心——**任何 Channel 都不需要关心 Agent 当前状态**。pi-agent-core 的 `steer()` 负责把消息排到下一个 turn 开始，`prompt()` 负责启动新 turn。

> **边界**：Scorel 初期不支持工具执行中段的硬中断。用户若想"立刻停"，UI 层应该显式调 `abort()`，而不是期望 `steer()` 能打断当前工具。

---

## 4. 消息载体：`<system_reminder>` 包裹

非 CLI 的 Channel 注入时，用 `<system_reminder>` XML 包裹原始内容，让 LLM 明确区分"用户亲口说"和"系统代为转达"：

```typescript
await inject({
  role: 'user',
  content: `<system_reminder source="telegram" from="${msg.from}">
${msg.content}
</system_reminder>`,
  timestamp: Date.now(),
});

// 同步记录 channel 元数据，便于审计
await session.append({
  kind: 'channel',
  channel: 'telegram',
  externalId: msg.id,
  at: Date.now(),
});
```

`channel` 类型的 LogEntry 不走 LLM（参见 `d001` 两层消息），只供 replay / UI / 审计使用。

---

## 5. 初期落地的 Channel

| Channel | 形态 | 初期范围 |
|---------|------|----------|
| `cli` | stdin/stdout REPL | ✅ 初期 |
| `http` | POST /chat (SSE) | ✅ 初期（Cloud Daemon 的最小形态） |
| `telegram` | Bot API | 后期 |
| `wechat` | WeCom / 非官方桥 | 后期 |
| `cron` | 定时任务触发（`node-cron`） | 后期 |

初期只需要 `cli` 一条就能跑通本地体验；`http` 在 Cloud Daemon 起步时补上。IM 与 cron 走同一个 `ChannelAdapter` 接口，不需要额外架构变更。

---

## 6. 应用形态与 Channel 的映射

Scorel 的三种 App 形态，本质上都是"一组 Channel + 核心"：

**CLI（初期）**
- 进程内直接持有 Agent，`cli` Channel 串起 REPL
- 斜杠命令由 Extension 注册（详见 `d004-extensions.md`）

**GUI（后期）**
- Tauri 架构：Main 进程持有 Agent，Renderer 通过 IPC 订阅 `ScorelEvent`
- Agent 不走 HTTP，延迟等于函数调用

**Cloud Daemon（后期）**
- 持久运行，同时挂多个 Channel：`http` + `telegram` + `cron` + ...
- Daemon 是 SessionStore 的唯一写入者，CLI/GUI 可以 Bind 到 Daemon 共享 session，避免多进程并发写 JSONL

---

## 7. 延后项

- IM Channel（Telegram、企业微信、Slack、WeCom）的具体实现
- `cron` Channel 的调度模型
- GUI / Cloud Daemon 的完整设计（有了 Channel 抽象后，它们是"组装题"而不是"架构题"）
- Bind 模式下 CLI/GUI ↔ Daemon 的认证与状态同步协议

---

*Channel 层只负责把多样的外部输入变成统一的 `AgentMessage`。一旦进入 Agent，所有下游模块看到的都是同一种形状。*
