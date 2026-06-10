# S0083: Extension Manifest And IM Channel Runtime

## Goal

Add the smallest extension and IM channel foundation that lets Scorel receive external IM messages, run them through the existing Host/Runtime path, and send replies back through the same channel.

The business value is a new entry surface without a second agent stack: IM becomes a thin channel extension around `ScorelHost`, not a new runtime, queue, session store, or relay path.

The design principles for this spec are:

- elegant: channel code should be a narrow bridge, not a parallel product core;
- minimally invasive: reuse `ScorelHost`, `DaemonClient`, session JSONL, follow-up, steer, skills, tools, and memory;
- extensible: Telegram is only the first built-in channel, not a special case in core;
- simple: V1 supports current-conversation replies only.

## Source Of Truth

- `docs/architecture.md`: CLI, WebUI, GUI, IM, and HTTP API are thin entries over the same Host.
- `docs/spec/extensions.md`: extensions live under `~/.scorel/extensions/` and optional project `.scorel/extensions/`.
- `docs/spec/channels.md`: channel docs must be updated by this spec to match the extension-backed channel bridge.
- `docs/spec/ship/S0051-harness-item-and-system-reminder.md`: channel context must use `harness_item` and `<system-reminder>`.
- `docs/spec/ship/S0052-follow-up-queue-and-dual-loop.md`: IM must reuse existing follow-up and steer queues.
- `docs/spec/ship/S0053-skill-index-and-skill-tool.md`: enabled extension skill roots must enter the existing skill scanner.

## Scope

### 1. Extension Manifest

Introduce a manifest file named:

```text
scorel.extension.json
```

Minimum schema:

```typescript
type ExtensionManifest = {
  id: string;
  kind: "im";
  displayName: string;
  adapter: string;
  skills?: string[];
  mcp?: unknown[];
};
```

Rules:

- `id` is the stable extension id and channel id, for example `telegram`.
- `kind = "im"` means the extension exposes an IM adapter.
- `adapter` is a path relative to the manifest directory.
- `skills` is a list of directories relative to the manifest directory.
- `mcp` is parsed and preserved for future specs, but S0083 does not start MCP servers.

### 2. Extension Roots

Load enabled extension manifests from:

```text
~/.scorel/extensions/
.scorel/extensions/
extensions/builtin/
```

Rules:

- user extensions are under `~/.scorel/extensions/`;
- project extensions are under `.scorel/extensions/`;
- built-in extensions are shipped in the repo/package under `extensions/builtin/`;
- project extension id wins over user extension id;
- built-in extension id loses to both project and user extension id;
- V1 only starts extensions explicitly enabled in config.

### 3. Config

Add explicit config for enabled IM extensions.

Example:

```toml
[extensions.telegram]
enabled = true
kind = "im"

[extensions.telegram.config]
botTokenEnv = "SCOREL_TELEGRAM_BOT_TOKEN"
```

Rules:

- secrets are referenced by env var name only;
- raw tokens must not be written to config, JSONL, diagnostics, or memory;
- disabled extensions may be discovered but must not start.

### 4. IM Adapter Contract

Define the adapter boundary around platform IO only:

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

Adapter rules:

- adapter receives platform events and calls `onMessage`;
- adapter sends messages to platform targets through its `sendMessage` method;
- adapter must not create sessions;
- adapter must not write JSONL;
- adapter must not implement follow-up, steer, memory, tools, or skill loading;
- adapter errors are isolated and logged without crashing the Host.

### 5. Channel Bridge

Add a Host-side channel bridge that connects enabled IM adapters to existing Host use cases.

Responsibilities:

- map `(extensionId, externalConversationId)` to a fixed Scorel session;
- ensure the default workspace project exists at `~/.scorel/workspace`;
- call existing `send_message` / Host application service for incoming text;
- inject channel source context as a harness item for the current turn;
- expose the current channel context to `SendChannelMessage`;
- keep platform raw ids out of model-authored arguments.

The bridge is allowed to keep a small durable binding index under `~/.scorel/`, for example:

```text
~/.scorel/channels/im-bindings.json
```

The binding value must be replayable:

```typescript
type ImSessionBinding = {
  extensionId: string;
  externalConversationId: string;
  projectId: ProjectId;
  sessionId: SessionId;
  createdAt: number;
  updatedAt: number;
};
```

### 6. Default Workspace

IM sessions use the default workspace project:

```text
~/.scorel/workspace
```

Rules:

- the directory is created when the first enabled IM message needs it;
- it is registered as a normal Project in the existing Project Registry;
- it is not a special Runtime mode;
- future GUI settings may allow users to choose another workspace, but S0083 does not add that UI.

### 7. Incoming Message Semantics

Incoming IM messages must enter the existing runtime path.

Idle session:

```text
IM message -> normal send_message -> ordinary user_message
```

Running session:

```text
default -> runningBehavior: "follow_up"
explicit /steer or /interrupt -> runningBehavior: "steer"
```

Rules:

- no new follow-up queue;
- no new steer queue;
- no new IM runtime loop;
- no new Host daemon;
- no Relay dependency.

### 8. Channel Source Reminder

Before the Host runs the turn, append a channel source `harness_item`.

Example content:

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

Rules:

- use `harness_item`, not provider-level system prompt;
- the reminder is session evidence, not a user message;
- the reminder must not include raw platform secrets;
- raw user ids and raw group ids are allowed only in structured event data when needed for routing, not in model-facing text.

### 9. SendChannelMessage Tool

Add a built-in runtime tool available only when the current turn has channel context:

```typescript
SendChannelMessage({
  text: string
})
```

Optional V1 shape is allowed if implementation needs explicit channel echo:

```typescript
SendChannelMessage({
  channel: string,
  target: "current",
  text: string
})
```

Rules:

- default target is the current external conversation;
- the model must not provide Telegram chat ids, Feishu open ids, Slack channel ids, or other raw platform ids;
- the Host resolves the current channel context to an adapter target;
- if no channel context exists, the tool returns `no_channel_context`;
- if the adapter send fails, the tool result is an error result and diagnostics record the adapter failure;
- the tool result must not echo secrets or raw tokens.

### 10. Extension Skills

When an extension is enabled, each manifest `skills` directory enters the existing skill scanner.

Rules:

- extension skills are discovered by the same skill index machinery as project/user skills;
- skill listing continues to enter the model through existing skill harness events;
- conflict order is project skill, user skill, extension skill, built-in skill;
- S0083 does not add a new Skill tool path.

### 11. Loopback IM Extension

Add one deterministic built-in loopback IM extension for tests and local verification.

It should behave like a channel extension, not a testing bypass:

- loaded through `scorel.extension.json`;
- started through the same extension lifecycle;
- receives incoming messages through a public local test hook or CLI/dev helper;
- sends outgoing `SendChannelMessage` payloads into an inspectable in-memory or temp-file outbox.

This validates the channel bridge without claiming Telegram support.

## Not In Scope

- Real Telegram API. That is S0084.
- Real Feishu, Slack, Discord, WeCom, or WeChat.
- Marketplace, remote installation, extension signing, or sandboxing.
- MCP server startup from extension manifests.
- Cross-conversation proactive send.
- User-facing GUI extension management.
- Webhook mode.
- Relay-based IM routing.
- A new Runtime, queue, session store, or daemon process for IM.

## Acceptance Criteria

- `scorel.extension.json` is parsed and validated.
- enabled `kind = "im"` extensions start with Host lifecycle and stop cleanly.
- disabled extensions do not start.
- enabled extension skill directories are included in the existing skill index.
- the default IM workspace is created at `~/.scorel/workspace` and registered as a normal Project.
- repeated messages from the same `(extensionId, externalConversationId)` reuse the same session.
- a running session receives normal IM messages as existing `follow_up` items.
- explicit `/steer` or `/interrupt` IM messages enter the existing steer path.
- channel source context is appended as a `harness_item` and reaches `buildContext()`.
- `SendChannelMessage({ text })` sends to the current adapter target without model-authored raw ids.
- loopback IM extension proves an incoming message can trigger a Host turn and a tool reply can reach the adapter outbox.
- `docs/spec/extensions.md` and `docs/spec/channels.md` are updated to match the implemented extension-backed channel bridge.

## Testing Requirements

- Manifest parser tests for required fields, relative paths, disabled extensions, and invalid manifests.
- Extension lifecycle tests proving enabled IM adapters start/stop and failures are isolated.
- Skill index tests proving enabled extension skill roots are scanned.
- Daemon/Host tests using the loopback IM extension with real temporary `~/.scorel` state and real JSONL sessions.
- Daemon/Host tests proving running IM messages reuse existing follow-up and steer queues.
- Tool tests proving `SendChannelMessage` resolves current channel context and rejects missing context.
- Full `pnpm typecheck && pnpm test`.

## Impacted Files

- `docs/spec/extensions.md`
- `docs/spec/channels.md`
- `packages/protocol/src/*`
- `packages/core/src/tools/*`
- `packages/core/src/session/*`
- `packages/daemon/src/*`
- `packages/client/src/*` if the Host application service needs a client-facing option type
- `extensions/builtin/loopback/*`
- tests near the changed modules

## Risks And Boundaries

- Extension loading can become a platform too quickly. S0083 must only implement what IM channel runtime needs.
- Raw platform ids are useful for routing but should not become model-authored parameters.
- Follow-up and steer already exist. Reimplementing them in channel code is a regression.
- The default workspace is convenient but broad. It must be a normal Project so future UI can inspect or move it.
- Loopback channel is a product-path verification tool for the channel bridge, not proof that a real IM provider works.

## Follow-Up Specs

- S0084: Built-in Telegram IM Extension.
- Feishu IM extension.
- Slack or Discord IM extension.
- GUI Settings for enabling and configuring IM extensions.
- Extension MCP startup.
- Cross-conversation channel target handles.
