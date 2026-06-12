# Channel — Extension-Backed IM Bridge

> 上游：`architecture.md`、`spec/daemon.md`、`spec/extensions.md`
> 当前落地：S0083 Extension Manifest And IM Channel Runtime

---

## 1. 定位

Channel 是外部消息入口。S0083 后，IM Channel 通过 Extension manifest 接入 Host：

```text
IM Adapter -> Channel Bridge -> ScorelHost -> ScorelRuntime -> SendChannelMessage -> IM Adapter
```

Channel 不拥有 Runtime、Session、queue、memory 或 replay。它只把外部 IM 消息转成现有 Host turn，并把模型通过 `SendChannelMessage` 发出的文本或附件元数据送回当前 IM 会话。

CLI / GUI / WebUI 仍然直接通过 DaemonClient / Host application service 操作 Host，不经过 Channel。

---

## 2. Extension Manifest

IM channel 由 extension 提供：

```json
{
  "id": "telegram",
  "kind": "im",
  "displayName": "Telegram",
  "adapter": "./adapter.js",
  "skills": ["./skills"]
}
```

`id` 同时是 extension id 和 channel id。启用 extension 后，其 `skills` 目录进入现有 Skill index。

---

## 3. Adapter Contract

Adapter 只处理平台 IO：

```typescript
interface ImAdapter {
  start(ctx: ImAdapterContext): Promise<void>;
  stop(): Promise<void>;
  sendMessage(target: ImTarget, message: ImOutgoingMessage): Promise<void>;
  setTyping?(target: ImTarget, typing: boolean): Promise<void>;
}

interface ImAdapterContext {
  onMessage(message: ImIncomingMessage): Promise<void>;
  logger: Logger;
}
```

Adapter 不创建 session，不写 JSONL，不实现 follow-up / steer，不读写 memory。

---

## 4. Channel Bridge

Host 内部 bridge 负责：

- `(extensionId, externalConversationId) -> sessionId` 固定绑定；
- 创建 / 注册默认 workspace：`~/.scorel/workspace`；
- 通过现有 `send_message` 路径提交用户消息；
- 注入 channel source `harness_item kind="channel_context"`；
- 为当前 channel turn 暴露 `SendChannelMessage` tool。

Binding 持久化在：

```text
~/.scorel/channels/im-bindings.json
```

---

## 5. Runtime Semantics

IM 消息复用现有 runtime 行为：

```text
idle session     -> ordinary user_message
running default  -> follow_up queue
/steer message   -> steer queue
/interrupt msg   -> steer queue
```

不新增 IM runtime，不新增 IM queue。

---

## 6. Source Reminder

每个 IM turn 会在用户消息前注入 hidden channel reminder：

```xml
<system-reminder>
This message came from an IM channel.

channel: telegram
conversation_type: group
sender_display_name: Chanler
mentioned_bot: true

Use SendChannelMessage to reply to the current conversation when needed.
</system-reminder>
```

模型可见的是来源语义，不是 raw platform id。raw chat id / open id 只作为 routing data 保存在 bridge/adapter context。

---

## 7. Reply Tool

当前已落地的回复工具：

```typescript
SendChannelMessage({
  text?: string,
  attachments?: Array<{
    type: "image" | "file",
    path?: string,
    url?: string,
    mimeType?: string,
    caption?: string
  }>
})
```

规则：

- 默认目标是当前 IM conversation；
- `text` 和 `attachments` 至少提供一个；
- adapter 可以对暂不支持的附件返回明确 tool error，不能静默忽略；
- 模型不填写 Telegram chat id、飞书 open id、Slack channel id 等 raw id；
- 无 channel context 时返回 `no_channel_context`；
- adapter send 失败时返回 tool error 并写 diagnostics。

---

## 8. Built-In Channels

当前 foundation 提供 built-in `loopback` IM extension，用于真实 Host/JSONL/tool 链路验证。

后续真实 provider：

- S0084: Telegram Bot API long polling；
- S0091: QQ Bot / WeChat official bot-style adapter；
- S0092: structured `SendChannelMessage` payload and IM response cadence。

---

## 9. 延后项

- Telegram webhook mode；
- GUI extension management；
- extension marketplace / signing / sandbox；
- extension MCP server startup；
- proactive cross-conversation send；
- cron / webhook channel。
