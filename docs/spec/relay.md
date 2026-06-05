# Relay Proxy And Hosted Entry

> 上游：`architecture.md`、`decisions/007-relay-proxy-and-entry-routing.md`、`spec/client.md`、`spec/daemon.md`
> 主题：Hosted WebUI / GUI / CLI Entry 通过 Relay 连接用户 Device-level Host。

---

## 0. 定位

Relay 是 **authenticated proxy + authorization registry**。

Relay 只解决两件事：

1. 让 Entry 和 Host 在公网不可直连时通过一个稳定服务相遇。
2. 记录哪些 Entry 被允许通过 Relay 控制哪些 Device。

Relay 不是 hosted daemon，也不是新的后端领域层。Project、Session、Runtime、tool execution、JSONL、replay 和 resync authority 仍然只属于 Host。

---

## 1. 角色

```text
Entry / WebUI / GUI / CLI
  -> Relay
    -> Host / Daemon
      -> Project / Session / Runtime / JSONL
```

| 角色 | 职责 |
|---|---|
| Entry | 用户操作入口。持有稳定 `clientId`，通过 direct WS 或 Relay 连接 Host。 |
| Relay | 聚合授权关系和在线路由。只转发 daemon wire payload，不解释 Scorel 业务语义。 |
| Host / Daemon | Device-level Host。拥有 Project Registry、Session JSONL、Runtime、工具和事件流。 |

术语说明：

- `deviceId`：被控制的 Host / Daemon Device 身份。
- `clientId`：控制 Host 的 Entry 身份。Relay 讨论中也可称为 `entryId`，但协议和 JSONL 继续使用现有 `clientId` 字段。

---

## 2. 不变量

1. Relay 不存 Project Registry。
2. Relay 不存 Session JSONL。
3. Relay 不存 prompt、tool result、provider response 或 runtime diagnostics。
4. Relay 不做 replay、resync、context build 或 Runtime 调度。
5. Relay durable state 只包含 identity metadata 和授权关系。
6. Relay transient state 只包含 pair session、presence、socket route。
7. Host 仍然是唯一 Session writer。
8. `user_message.clientId` 表示发起该用户动作的 Entry。
9. Direct WS 和 Relay 只替换 transport，不改变 Device -> Project -> Session 层级。

---

## 3. Relay 状态

### 3.1 Durable Store

Relay 可以持久化：

```typescript
type RelayDeviceRecord = {
  deviceId: DeviceId;
  devicePublicKey?: string;
  label?: string;
  createdAt: number;
  updatedAt: number;
};

type RelayClientRecord = {
  clientId: ClientId;
  clientPublicKey?: string;
  label?: string;
  createdAt: number;
  updatedAt: number;
};

type RelayBindingRecord = {
  deviceId: DeviceId;
  clientId: ClientId;
  createdAt: number;
  revokedAt?: number;
};
```

V1 可以先把 public key 字段作为 identity contract 预留；具体签名和 key lifecycle 由后续实现 spec 收口。

### 3.2 Transient State

Relay 内存态：

```typescript
type RelayPresence = {
  devices: Map<DeviceId, HostSocket>;
  clients: Map<ClientId, EntrySocket[]>;
};

type PairSession = {
  pairCode: string;
  clientId: ClientId;
  expiresAt: number;
};
```

Pair session 是短期、一次性状态。Relay 重启后允许丢失。

### 3.3 Forbidden State

Relay 不得持久化或缓存：

- Project / Project Registry
- Session summary / transcript / JSONL
- prompt / tool result / provider response
- Runtime state / context / diagnostics
- resync event cache / replay state

---

## 4. 配对

V1 使用 Entry-initiated pairing：

```text
Entry
  -> Relay: create_pair_session(clientId)
  <- Relay: pairCode

User
  -> Host: scorel pair <pairCode>

Host
  -> Relay: redeem_pair(pairCode, deviceId)
  -> Relay persists binding { deviceId, clientId }
```

配对语义：

- 用户在本机运行 `scorel pair <code>` 是授权动作。
- Pair code 只用于创建 `deviceId -> clientId` 授权关系。
- Pair code 不是长期 secret。
- Pair code 过期或被使用后必须失效。

Host 可以在本地保存 authorized client allowlist。Relay binding 负责路由前置检查；Host allowlist 负责最终准入检查。V1 可以先由 Relay binding 承担准入，但正式 spec 应保留 Host-side allowlist 的长期方向。

---

## 5. 连接与路由

Relay 连接有两条物理 WebSocket：

```text
Entry  -> Relay
Host   -> Relay
```

Entry 连 Host 不需要再建立第三条网络连接。Relay 只在已有 socket 上做逻辑路由：

```text
Entry socket + deviceId -> Relay -> Host socket
```

### 5.1 Presence

Host relay mode：

```text
Host
  -> load device identity
  -> connect Relay
  -> announce deviceId
  -> Relay marks deviceId online
```

Entry / hosted WebUI：

```text
Entry
  -> load stable clientId
  -> connect Relay
  -> announce clientId
  -> Relay marks clientId online
```

Presence 只表示在线，不代表授权。

### 5.2 Routing Frame

Entry 发往 Relay：

```typescript
type EntryToRelayFrame = {
  deviceId: DeviceId;
  payload: ClientMessage;
};
```

Relay 检查：

```text
binding exists for (deviceId, clientId)
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

Relay 再把 payload 发回对应 Entry socket。

`clientId` 是现有 daemon wire / JSONL 字段。它在 Relay 语境中就是 Entry identity。不要为 V1 额外引入 `entryId` 或 `routeId` 字段，除非实现证明现有 `clientId` 无法覆盖多 tab / 多连接的 return path。

---

## 6. DaemonClient 语义

Relay 是 transport adapter：

```typescript
const transport = new RelayTransport({
  relayUrl,
  deviceId,
  clientId,
});

const client = new DaemonClient(transport, options);
await client.connect(sessionId);
```

Direct WS 与 Relay 的差异只在 transport 层：

```text
Direct:
  DaemonClient -> WsTransport -> Host

Relay:
  DaemonClient -> RelayTransport -> Relay -> Host relay adapter -> Host
```

进入 Host 后，仍然是现有 Host API：

- `listProjects`
- `listSessions`
- `createSession`
- `sendMessage`
- `rewriteQueue`
- `cancel`
- `subscribeEvents`
- `resyncEvents`

Host 不应复制一套 Relay-only Project、Session 或 Runtime 逻辑。

---

## 7. WebUI 多设备模型

Hosted WebUI 可以添加很多 Device。每个 Device 可以有多个 connector：

```typescript
type WebUiDevice = {
  id: string;
  remoteIdentity?: {
    deviceId: DeviceId;
  };
  connectors: DeviceConnector[];
};

type DeviceConnector =
  | { kind: "direct_ws"; url: string; token: string }
  | { kind: "relay"; relayUrl: string; deviceId: DeviceId; clientId: ClientId };
```

规则：

- Device 是业务身份，connector 是可达路径。
- 同一 `deviceId` 通过 direct WS 和 Relay 都可达时，WebUI 应合并为一个 Device。
- `deviceId + projectId + sessionId` 是缓存 scope，不是 URL 或 connector。
- Relay 可以返回授权 Device 列表和在线状态；Project / Session 列表仍然必须通过 Host API 获取。

连接选择：

1. direct local WS healthy 时优先直连。
2. direct 不可用且 Relay presence 在线时使用 Relay。
3. 都不可用时显示离线缓存。

---

## 8. 重连与恢复

Relay 不做 Session replay。

断线恢复：

```text
Entry reconnects Relay
Host reconnects Relay
Entry sends existing DaemonClient.connect/resync through Relay
Host answers from JSONL / live buffer
```

恢复锚点仍然是 Host 语义：

- `persistentLastSeq`
- `streamLastSeq`

Relay 重启会丢失 presence 和 pair sessions，但 durable bindings 可以保留。Relay 重启不影响 Host JSONL authority。

---

## 9. 不做什么

- 不实现 hosted execution。
- 不要求 V1 必须有用户账号。
- 不把 Relay 变成 Project / Session 后端。
- 不让 Relay 解释 daemon wire payload。
- 不在 Relay 中实现 replay / resync / context build。
- 不在本 spec 定义细粒度 ACL。
- 不在本 spec 实现 desktop GUI、SSH bootstrap 或 HTTP API。

---

## 10. 目录结构

Relay service 是可部署产品入口，默认放在 `apps/relay`，不是新的领域包。

```text
apps/
  relay/
    package.json
    src/
      index.ts          # process entrypoint
      server.ts         # WebSocket / HTTP server bootstrap
      store.ts          # durable device/client/binding store adapter
      pairing.ts        # short-lived pair sessions
      presence.ts       # online device/client socket registry
      routing.ts        # deviceId/clientId authorization check and proxy routing
      diagnostics.ts    # relay-side logs without user payload

packages/
  protocol/
    src/relay.ts        # Relay frame and record types
  client/
    src/relay-transport.ts
  daemon/
    src/relay/
      host-client.ts    # Host outbound Relay connection
      pair.ts           # scorel pair support helpers

apps/
  cli/
    src/relay-cli.ts    # scorel pair / relay-related commands
  webui/
    ...                 # direct connector + relay connector UI
```

分工规则：

- `apps/relay`：只包含 deployable Relay service 和它的 runtime wiring。
- `packages/protocol`：放 Relay frame、record、request/response 类型；保持 browser-safe、零 Node 依赖。
- `packages/client`：放 `RelayTransport`，实现现有 `DaemonTransport` contract。
- `packages/daemon`：放 Host outbound Relay adapter；它把 Relay frame 转回现有 Host handler。
- `apps/cli`：只放命令入口，例如 `scorel pair <code>`。
- `apps/webui`：只放 connector UI、Device registry 和 `RelayTransport` 使用逻辑。

不要创建顶层 `relay/` 目录。当前 workspace 只约定 `apps/*` 和 `packages/*`；顶层目录会绕开现有 monorepo 边界。

不要默认创建 `packages/relay`。只有当 Relay server 逻辑需要被多个 deployable app 复用时，才把纯库部分提取为 `packages/relay-server` 或类似名字；V1 先把服务私有逻辑留在 `apps/relay/src`，避免过早抽象。

---

*Relay 的产品价值是让多 Entry 和多 Device 通过一个稳定服务形成授权连接图；Scorel 的业务真相仍然在 Device-level Host。*
