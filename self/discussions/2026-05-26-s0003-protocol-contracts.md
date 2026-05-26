# S0003 Protocol Contracts 执行记录

**日期**：2026-05-26
**任务**：按 `docs/spec/ship/S0003-protocol-contracts.md` 定义 M1 最小跨包协议契约。

## 范围确认

- 只在 `@scorel/protocol` 中定义 M1 需要共享的 ID、消息、事件、wire envelope 与 transport interface。
- `@scorel/core`、`@scorel/daemon`、`@scorel/client` 只从 protocol 导入共享类型，不新增本地协议副本。
- 不实现 auth、WebSocket/socket transport、daemon 行为、session store、runtime loop、rewind/compact/checkpoint/channel 协议。

## 实现取舍

- Persistent events 只覆盖 M1 路径：`session_header`、`user_message`、`assistant_message`、`tool_result`。
- Transient events 只覆盖 CLI Alpha 所需流式状态：`turn_start`、`turn_end`、`message_start`、`message_end`、`text_delta`、`error`。
- Request/response 使用 `ClientRequestMap` 建立类型配对，避免后续 client/daemon 各自 invent response shape。
- `DaemonTransport` 放在 protocol，client 与 embedded transport 都只依赖该 interface。
- Browser safety 用测试扫描 protocol source，确保不导入 Node built-ins。

## 验证

- `pnpm --filter @scorel/protocol typecheck` 通过。
- `pnpm --filter @scorel/protocol test` 通过。
- `pnpm check` 通过。
