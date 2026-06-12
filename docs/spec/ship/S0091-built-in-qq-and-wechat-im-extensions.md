# S0091: Built-In QQ And WeChat IM Extensions

## Goal

Add QQ Bot and WeChat as built-in IM extensions on the existing extension-backed channel bridge.

The business value is channel reach. Telegram proved the bridge; QQ and WeChat force the adapter contract to stay generic enough for multiple IM platforms without forking Scorel runtime behavior.

## Product Boundary

Scorel must use official or documented bot/server APIs. This spec does not support personal-account reverse engineering, browser automation of consumer clients, unofficial Web WeChat scraping, or any path likely to get user accounts restricted.

## Scope

### Shared IM Adapter Utilities

- Extract reusable helpers for HTTP polling/webhook-shaped adapters where the current Telegram code has platform-neutral logic.
- Keep platform-specific authentication, payload parsing, mention rules, and send APIs inside each built-in extension.
- Preserve the S0083 adapter boundary: adapters do platform IO only and never create sessions or write JSONL.

### QQ Bot Extension

Add:

```text
extensions/builtin/qq/
  scorel.extension.json
  adapter.js
  adapter.d.ts
  skills/qq/SKILL.md
```

Expected config shape:

```toml
[extensions.qq]
enabled = true
kind = "im"

[extensions.qq.config]
appId = "..."
secretEnv = "SCOREL_QQ_BOT_SECRET"
tokenEnv = "SCOREL_QQ_BOT_TOKEN"
pollIntervalMs = 1000
allowedConversationIds = "..."
```

V1 may implement a local HTTP-stubbed adapter contract if live QQ Bot API credentials are unavailable in this environment, but the shipped adapter API must mirror real QQ Bot message/send semantics.

### WeChat Extension

Add:

```text
extensions/builtin/wechat/
  scorel.extension.json
  adapter.js
  adapter.d.ts
  skills/wechat/SKILL.md
```

Expected config shape:

```toml
[extensions.wechat]
enabled = true
kind = "im"

[extensions.wechat.config]
appId = "..."
secretEnv = "SCOREL_WECHAT_SECRET"
tokenEnv = "SCOREL_WECHAT_TOKEN"
pollIntervalMs = 1000
allowedConversationIds = "..."
```

Use WeChat Official Account / WeCom-style bot semantics where messages have stable conversation identity and official reply/send APIs. Do not implement consumer WeChat personal account automation.

### Skills

Each built-in extension must include a platform-specific skill that tells the model:

- what kind of conversation it is replying to;
- how mentions/group context should be interpreted;
- platform etiquette and short-response expectations;
- when to use `SendChannelMessage`;
- what not to assume about raw platform ids.

## Not In Scope

- Consumer QQ/WeChat personal account login.
- Public webhook deployment, TLS, or hosted ingress.
- Rich media send support; covered by S0092.
- GUI Settings layout; covered by S0093.
- Remote Relay management of IM settings.

## Acceptance Criteria

- QQ and WeChat built-in extension manifests are discoverable by the existing loader.
- Each extension starts only when explicitly enabled and required credentials are present.
- Each adapter normalizes incoming text messages into the existing `ImIncomingMessage` shape.
- Each adapter sends plain text replies through the existing `SendChannelMessage` path.
- Adapter diagnostics redact secrets.
- QQ, WeChat, Telegram, and loopback share the same channel bridge and session binding behavior.
- No QQ/WeChat-specific branch is added to runtime/session/core channel orchestration.

## Testing Requirements

- Manifest loader coverage for QQ and WeChat built-ins.
- Adapter normalization tests using local HTTP stubs or pure parser fixtures.
- Send-message tests proving each adapter maps `SendChannelMessage` to its platform send API shape.
- Secret redaction tests.
- Full `pnpm typecheck && pnpm test`.

## Status

Planned.
