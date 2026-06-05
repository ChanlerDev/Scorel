# ADR-007: Relay Proxy And Entry Routing

**状态**：已确认
**日期**：2026-06-05
**参与者**：Chanler, Codex

## 决策

Scorel Relay 定位为 **authenticated proxy + authorization registry**。

Relay 持久化最小授权关系：

```text
deviceId -> allowed clientId
```

Relay 运行时维护在线 socket 和路由状态：

```text
clientId socket -> Relay -> deviceId socket
```

Relay 不拥有 Project、Session、Runtime、tool execution、JSONL、replay 或 resync 语义。所有 Scorel 业务 payload 继续使用现有 daemon wire protocol，只在 Relay transport 外层增加 `deviceId` 路由和授权检查。

## 背景

Scorel 已经有 Device-level Host、WebUI Device -> Project -> Session 模型和 direct `WsTransport`。但 hosted WebUI 面向普通用户时不能要求每台用户机器暴露公网 `wss://` daemon。

需要一个稳定中转点，让：

- Host 主动 outbound 连接 Relay。
- Entry/WebUI 连接 Relay。
- Relay 检查 Entry 是否被授权访问目标 Device。
- Relay 把现有 daemon wire messages 转发到目标 Host。

这解决网络可达性和多设备聚合问题，但不能把 Relay 扩成新的业务后端。

## 语义

- `deviceId` 表示被控制的 Host / Daemon Device。
- `clientId` 表示控制 Host 的 Entry。Relay 讨论中可称为 entry identity，但协议和 JSONL 继续使用现有 `clientId` 字段。
- `user_message.clientId` 表示发起该用户动作的 Entry。
- WebUI 中的 Device 是业务身份；direct WS、Relay 只是 connector。

## 配对

V1 采用 Entry 发起配对：

1. Entry/WebUI 创建 pair session，得到短期 pair code。
2. 用户在本机执行 `scorel pair <code>`。
3. Host 用自己的 `deviceId` 兑换 pair code。
4. Relay 写入 `deviceId -> clientId` binding。

pair code 是临时授权流程，不是长期 secret。

## 路由

Entry 发往 Relay：

```typescript
type EntryToRelayFrame = {
  deviceId: DeviceId;
  payload: ClientMessage;
};
```

Relay 检查：

```text
binding(deviceId, clientId) exists
deviceId is online
```

Relay 发往 Host：

```typescript
type RelayToHostFrame = {
  clientId: ClientId;
  payload: ClientMessage;
};
```

Host 发回 Relay：

```typescript
type HostToRelayFrame = {
  clientId: ClientId;
  payload: DaemonMessage;
};
```

不要为了 V1 引入独立 `routeId`。`deviceId` 选择目标 Host，`clientId` 表达 Entry identity 和返回路径。只有当实现证明多 tab / 多连接无法用现有 `clientId` 表达时，才新增 route correlation 字段。

## 取舍

选择 Relay proxy：

- 普通用户不需要公网 daemon。
- hosted WebUI 可以聚合多个 Device。
- Host 仍然是业务真相源。
- 实现可以复用 `DaemonClient` 和 Host API。

不选择 hosted daemon：

- 会把用户 workspace、tools、provider secrets、Session authority 搬到云端。
- 会改变 Scorel 的产品边界和安全模型。
- 会复制 Project / Session / Runtime 逻辑。

不选择只做 desktop GUI：

- GUI 不能解决 hosted WebUI 和公网可达性问题。
- Relay 先锁定身份和连接图，GUI 后续可以复用同一 transport 模型。

## 影响

- 新增 [`docs/spec/relay.md`](../spec/relay.md) 作为抽象规约。
- `docs/ROADMAP.md` 将下一阶段调整为 Relay + Hosted WebUI。
- `docs/spec/client.md` 增加 `RelayTransport` 作为未来 transport adapter。
- `docs/architecture.md` 明确 Relay 是 transport/control-plane extension，不是 Host 领域层。
- Relay service 作为 deployable app 放在 `apps/relay`；共享类型进 `packages/protocol`，transport 进 `packages/client`，Host outbound adapter 进 `packages/daemon`。

## 不做什么

- 不引入用户账号作为 V1 必需条件。
- 不在 Relay 保存 Project、Session、prompt、tool result 或 replay cache。
- 不改变 JSONL 事件结构。
- 不把 `clientId` 拆成新的 `entryId` 字段。
- 不创建顶层 `relay/` 目录。
- 不默认创建 `packages/relay`；除非后续有明确复用压力。
- 不实现 GUI、SSH bootstrap 或 HTTP API。
