# Channel — Daemon 内部的消息注入适配器

> 上游：`architecture.md`、`spec/daemon.md`
> 主题：把 IM 消息、cron 触发等外部输入归一为 Daemon 内部的 `AgentMessage` 注入。

---

## 1. 设计目标

Channel 是 **Daemon 内部的子模块**，负责将非交互式的外部输入（IM、cron、webhook）转化为标准的 `AgentMessage` 注入 Runtime。

**不再是**：Entry 的统一入口（Entry 通过 DaemonClient 协议直连 Daemon）。

Channel 只处理那些"不是人坐在终端前打字"的输入源。CLI / GUI / WebUI 这些交互式 Entry 直接通过 DaemonClient 协议发送指令，不经过 Channel。

---

## 2. Channel 与 Entry 的区别

| | Entry（交互式） | Channel（非交互式） |
|---|---|---|
| 例子 | CLI / GUI / WebUI | Telegram Bot / cron / webhook |
| 连接方式 | DaemonClient 协议 | Daemon 内部模块 |
| 生命周期 | 用户主动连接/断开 | Daemon 启动时加载，持续运行 |
| 双向通信 | ✅ 收发 event | ❌ 只注入消息，不接收实时事件流 |
| 输出回传 | DaemonClient event stream | Channel 自行轮询或 hook 回调 |

---

## 3. ChannelAdapter 接口

```typescript
interface ChannelAdapter {
  readonly id: string;                       // 'telegram' | 'wechat' | 'cron' | 'webhook'
  start(ctx: ChannelContext): Promise<void>;
  stop(): Promise<void>;
}

interface ChannelContext {
  inject: MessageInjector;
  subscribe: (cb: (event: ScorelEvent) => void) => () => void;
  config: ChannelConfig;
}

type MessageInjector = (msg: AgentMessage) => Promise<void>;
```

Channel 职责：
1. 从外部源接收消息
2. 调 `inject(msg)` 注入 Daemon
3. 可选：订阅 event 流用于回传结果（如 Telegram bot 需要把 assistant 回复发回群里）

---

## 4. Injector：Daemon 内部路由

```typescript
// Daemon 内部实现
function createInjector(daemon: Daemon): MessageInjector {
  return async (msg) => {
    // 走 session lane 串行化，与 DaemonClient.prompt() 同等待遇
    await daemon.enqueue({ method: "prompt", params: { text: msg } });
  };
}
```

Channel 注入的消息和 DaemonClient 发来的 prompt **走同一条路径**，享受同样的并发控制和事件广播。

---

## 5. 消息载体：`<system_reminder>` 包裹

非交互式 Channel 注入时，用 `<system_reminder>` XML 包裹，让 LLM 区分来源：

```typescript
await inject({
  role: 'user',
  content: `<system_reminder source="telegram" from="${msg.from}">
${msg.content}
</system_reminder>`,
  timestamp: Date.now(),
});
```

---

## 6. 初期落地的 Channel

| Channel | 形态 | 阶段 |
|---------|------|------|
| `telegram` | Bot API，收到 mention/DM 时注入 | 后期 |
| `wechat` | WeCom / 非官方桥 | 后期 |
| `cron` | 定时任务触发（`node-cron`） | 后期 |
| `webhook` | HTTP POST 触发注入 | 后期 |

**初期不需要任何 Channel**。CLI/GUI 通过 DaemonClient 直连 Daemon，Channel 是 IM/自动化场景的补充。

---

## 7. Channel 输出回传

IM Bot 需要把 agent 回复发回对话。两种方式：

**方式 A：subscribe event stream（推荐）**
```typescript
class TelegramChannel implements ChannelAdapter {
  async start(ctx: ChannelContext) {
    // 订阅 assistant 消息，发回 Telegram
    ctx.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        this.sendToTelegram(event.message);
      }
    });
    // 监听 Telegram 消息，注入 Daemon
    this.bot.on("message", (msg) => ctx.inject(wrapMessage(msg)));
  }
}
```

**方式 B：afterTurn hook（简单场景）**
```typescript
// 作为 Extension 实现，在每轮结束后回传
onEvent: async (event) => {
  if (event.type === "turn_end") { ... }
}
```

---

## 8. 与 Daemon 的关系

```
Daemon
  ├── DaemonServer（处理 client 连接：CLI/GUI/WebUI）
  ├── ChannelManager（管理非交互式输入源）
  │     ├── TelegramChannel
  │     ├── CronChannel
  │     └── WebhookChannel
  ├── SessionManager
  └── ScorelRuntime
```

Channel 是 Daemon 的可选模块。纯本地 embedded 模式下不加载任何 Channel。

---

## 9. 延后项

- IM Channel 具体实现（Telegram、企业微信、Slack）
- cron Channel 调度模型
- Channel 级别的消息去重/防抖（IM 群消息风暴）
- Channel 权限（哪些群/用户能触发 agent）

---

*Channel 从"所有输入的统一入口"收窄为"Daemon 内部的非交互式消息源适配器"。交互式 Entry 通过 DaemonClient 协议直连，不经过 Channel。*
