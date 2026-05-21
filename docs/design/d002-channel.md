# d002 — Entry、Host、EventBus 与 Gateway

> 上游：`d000-architecture.md`
> 主题：把 CLI、GUI、HTTP、IM、cron、GitHub App 等入口收敛到同一套 session host、event store 和 gateway，而不是让每个入口各自拼装 agent。

---

## 1. 核心结构

Scorel 的入口会很多，但架构只保留四层：

```text
Entry   -> Gateway   -> Host       -> Core
用户入口   连接网关      运行宿主       执行内核
```

- **Entry**：用户或外部系统怎么进来。
- **Gateway**：用什么连接协议控制/订阅 session，例如 HTTP+SSE、WebSocket、Webhook、IPC。
- **Host**：Core 跑在哪里，session、event store 和 live event 怎么管理。
- **Core**：真正执行 agent loop、session replay、tools、extensions、config。

入口可以很多，但厚的层只有 **Host** 和 **Core**。

---

## 2. Entry

Entry 只处理输入输出和用户体验。

| Entry | 职责 |
|-------|------|
| 非交互式 CLI | 参数解析、一次性 prompt、stdout/stderr 输出 |
| 交互式 CLI / TUI | 多轮输入、session 切换、history/rewind/fork 命令 |
| GUI | session list、chat view、tool panel、event timeline、config 可视化 |
| HTTP client / mobile Shortcut | 发送文字、录音或自动化指令，接收结果 |
| IM connector | 接收 IM 消息，回写 IM 回复 |
| GitHub App / Webhook | 接收 issue / PR / action 事件，回写 comment |
| Cron / Scheduler | 定时触发任务 |

Entry 不直接实现 runtime，不直接写 JSONL，不自己执行 tools。

---

## 3. Host

Host 是 runtime 宿主。它负责把 `packages/core` 按某种生命周期跑起来。

```typescript
interface ScorelHost {
  createSession(input: CreateSessionInput): Promise<SessionRef>;
  openSession(sessionId: string): Promise<SessionRef>;
  listSessions(): Promise<SessionSummary[]>;
  closeSession(sessionId: string): Promise<void>;

  prompt(sessionId: string, input: PromptInput): Promise<RunRef>;
  abort(sessionId: string): Promise<void>;
  events(sessionId: string): AsyncIterable<ScorelEvent>;
  history(sessionId: string): Promise<ScorelHistoryItem[]>;
  rewind(sessionId: string, targetMessageId: string): Promise<ReplayResult>;
  fork(sessionId: string, targetMessageId: string): Promise<SessionRef>;
}
```

所有操作都带 `sessionId`，所以 in-process host 和 daemon host 都支持多 session。

### InProcessHost

Runtime 跑在当前进程内。

- 给非交互式 CLI、交互式 CLI、未来 TUI 使用。
- 可以打开多个 session。
- CLI UI 当前可以只 active 一个 session。
- 进程退出后 active runtime 缓存消失，但 JSONL 已持久化，下次通过 replay 恢复。

### DaemonHost

Runtime 跑在长期后台进程内。

- 给 GUI、HTTP、IM、GitHub、cron、mobile、cloud server 使用。
- 长期持有 active session registry。
- 持有 per-session runtime。
- 管 abort。
- 管 session writer ownership。
- 拥有 per-session EventBus。
- 从 per-session JSONL event store replay session。

---

## 4. Event Store 与 EventBus

Scorel 应该同时有 durable event store 和 live EventBus：

```text
Session JSONL
  durable event store
        |
        v
Session replay
  builds messages/history/state

ScorelRuntime
  emits live ScorelEvent
        |
        v
Host EventBus
        |
        +--> CLI renderer
        +--> GUI timeline
        +--> HTTP SSE
        +--> WebSocket
        +--> Extension onEvent
        +--> Session persistence
```

职责划分：

- **Session JSONL**：每个 session 的 durable event store，用于 replay / rewind / fork / audit。
- **Runtime**：发执行过程中的 live event。
- **Host EventBus**：负责 per-session fan-out、订阅管理、断连处理。
- **Gateway**：把 Host/EventBus 暴露成 SSE / WebSocket / Webhook / IPC。
- **Session persistence**：只把可 replay 的 durable event 写入 JSONL，不把所有 transient event 都落盘。

事件分两类：

| 类型 | 示例 | 是否持久化 |
|------|------|------------|
| Durable session event | `user_message`、`assistant_message`、`tool_result`、`run_started`、`run_finished`、`rewind`、`fork`、`compact`、`channel_metadata` | 落 JSONL |
| Live runtime event | `message_delta`、`thinking_delta`、`tool_execution_start`、`tool_execution_update`、`token_count`、`gateway_connected` | 默认不落主 JSONL |

这样 GUI 可以看到完整 streaming timeline，session replay 又不会被 delta/event 噪音污染。

Claude Code 的 JSONL 更接近 durable message chain：message、thinking、tool_use、tool_result 和 parent link 会进入日志。Codex 的 rollout JSONL 更偏 trace：session meta、turn context、event message、response item 都会记录。Scorel 采用中间路线：主 JSONL 优先保证 replay，完整 trace 后续可作为 debug/trace log 增加。

---

## 5. Gateway

Gateway 是连接层，把 Host 操作和 EventBus 映射成外部协议。

M9 最小 HTTP / SSE：

```text
POST /sessions
GET  /sessions
POST /sessions/:id/prompt
POST /sessions/:id/abort
GET  /sessions/:id/events
GET  /sessions/:id/history
```

SSE 只负责从某个 session 接收事件：

```text
GET /sessions/:id/events?fromSeq=123
```

WebSocket 可作为后续统一 gateway：

```text
client -> { type: "subscribe", sessionId, fromSeq }
client -> { type: "prompt", sessionId, text }
client -> { type: "abort", sessionId }
server -> { sessionId, seq, type, payload }
```

后续可扩展：

- WebSocket command/event gateway
- polling run status
- final response
- Webhook
- media input
- config API
- auth / audit

Gateway 不创建 runtime，不写 JSONL，不执行 tools。它只负责连接、鉴权、协议编解码和按 session 路由事件。

---

## 6. Core

Core 是纯库，负责真正执行。

- `ScorelRuntime`：agent loop、LLM stream、tool call、abort、runtime events。
- `ScorelSession`：JSONL、replay、history、rewind、fork、meta。
- tools：readonly、write、MCP wrapper。
- extensions：tools、commands、hooks、events。
- config：TOML、provider/model resolver、tool preset。
- prompt：system prompt 组装。
- pi-ai model layer：provider protocol 和 stream。

Core 不启动 HTTP server，不读终端，不画 GUI，不知道 Slack/GitHub/Shortcut。

---

## 7. 落地顺序

M9：

- 建立 `ScorelHost` 抽象。
- 实现 `InProcessHost`，让 CLI 本地路径逐步使用它。
- 实现 `DaemonHost`，持有 sessions、runtimes、per-session EventBus。
- 新增 daemon app，暴露 HTTP / SSE gateway。
- 实现 session writer ownership。

M10：

- GUI 连接 daemon。
- 做 session list、chat view、event timeline、tool panel、abort。
- 做配置可视化。

Future：

- IM connector。
- GitHub App / Webhook。
- mobile Shortcut / audio input。
- cloud server deployment。
- auth、多租户、审计、任务队列。

---

*最终判断：Scorel 应该是 event-driven runtime，但 EventBus 属于 Host，不直接塞进 Runtime。Runtime 发事件，Host 管事件，Service 暴露事件，Entry 渲染事件。*
