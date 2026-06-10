# S0084: Built-In Telegram IM Extension

## Goal

Ship Telegram as the first real built-in IM extension on top of the S0083 extension/channel foundation.

The business value is a real, locally runnable IM entry path: a user can message a Telegram bot, have the message enter a fixed Scorel session, and receive replies through `SendChannelMessage`.

Telegram is the first provider because Bot API long polling works from a local Host without webhook, public ingress, or Relay.

## Depends On

- S0083: Extension Manifest And IM Channel Runtime.

## Scope

### 1. Built-In Extension Layout

Add:

```text
extensions/builtin/telegram/
  scorel.extension.json
  adapter.js or adapter.ts
  skills/
    telegram/
      SKILL.md
```

The manifest must use:

```json
{
  "id": "telegram",
  "kind": "im",
  "displayName": "Telegram",
  "adapter": "./adapter.js",
  "skills": ["./skills"]
}
```

The extension skill should explain Telegram-specific behavior to the model at a high level: group vs DM, mention expectations, and reply etiquette. It must not contain secrets.

### 2. Config

Telegram is enabled through normal extension config:

```toml
[extensions.telegram]
enabled = true
kind = "im"

[extensions.telegram.config]
botTokenEnv = "SCOREL_TELEGRAM_BOT_TOKEN"
pollIntervalMs = 1000
allowedChatIds = []
```

Rules:

- `botTokenEnv` is required when enabled;
- the raw bot token is read from env at runtime only;
- `allowedChatIds` is optional and defaults to no allow-list in local dev;
- diagnostics must never print the raw bot token.

### 3. Telegram Adapter

Implement Telegram Bot API long polling.

Required behavior:

- call `getUpdates` with offset tracking;
- convert text messages into S0083 `ImIncomingMessage`;
- support private chats;
- support group/supergroup messages where the bot is mentioned or replied to;
- ignore non-text messages in V1 with a diagnostic entry;
- call `sendMessage` for `SendChannelMessage`;
- use `sendChatAction` for typing when available;
- stop polling cleanly on Host shutdown.

### 4. Conversation Identity

Telegram conversation id should be stable and deterministic.

Recommended mapping:

```text
private chat -> telegram:private:<chat.id>
group chat   -> telegram:group:<chat.id>
```

The raw `chat.id` is used for routing in adapter context, but model-facing reminders should only expose safe descriptive fields:

- `channel: telegram`
- `conversation_type: private | group | supergroup`
- `sender_display_name`
- `mentioned_bot`

### 5. Incoming Semantics

Reuse S0083:

- idle session -> normal prompt;
- running session -> default `follow_up`;
- `/steer ...` or `/interrupt ...` -> existing steer path;
- all turns use channel source reminder;
- replies use `SendChannelMessage`.

### 6. Reply Semantics

Telegram `SendChannelMessage` maps to Bot API `sendMessage`.

Rules:

- V1 sends plain text only;
- no Markdown/HTML parse mode by default;
- adapter may split messages that exceed Telegram length limits;
- send failures return tool error results and diagnostics.

### 7. Manual Smoke

Add a documented manual smoke path:

```bash
export SCOREL_TELEGRAM_BOT_TOKEN=...
pnpm scorel host serve
```

Then:

1. send the bot a private message;
2. verify `~/.scorel/workspace` project exists;
3. verify the same Telegram chat reuses one Scorel session;
4. verify JSONL contains the user message and channel reminder;
5. verify the model can call `SendChannelMessage` and the Telegram chat receives the reply.

## Not In Scope

- Telegram webhook mode.
- Inline keyboards.
- Media, files, voice, stickers, images, or albums.
- Markdown/HTML formatting.
- Multiple bot accounts.
- Proactive cross-chat sends.
- Admin commands.
- GUI settings for Telegram.
- Relay deployment.

## Acceptance Criteria

- Telegram built-in extension is discoverable through the S0083 manifest loader.
- Telegram starts only when enabled and `botTokenEnv` resolves.
- Telegram long polling receives private text messages.
- Telegram group messages are accepted only when bot mention/reply rules pass.
- incoming Telegram messages reuse the fixed session for the Telegram conversation.
- incoming messages enter existing Host runtime with S0083 channel reminder.
- running Telegram messages reuse existing follow-up/steer behavior.
- `SendChannelMessage` sends a Telegram `sendMessage` to the current chat.
- stop shuts down long polling without leaving active timers.
- manual smoke with a real Telegram bot token is documented.

## Testing Requirements

- Unit tests for Telegram update normalization.
- Unit tests for mention/reply acceptance rules.
- Unit tests for token redaction in diagnostics.
- Adapter tests using a local HTTP Telegram API stub for `getUpdates`, `sendMessage`, and `sendChatAction`.
- Host integration tests may use S0083 loopback for runtime semantics; Telegram tests cover provider-specific HTTP behavior.
- Manual smoke with a real Telegram bot token before marking S0084 done.
- Full `pnpm typecheck && pnpm test`.

## Impacted Files

- `extensions/builtin/telegram/*`
- `packages/daemon/src/*`
- `packages/core/src/config/*`
- `docs/spec/extensions.md`
- `docs/spec/channels.md`
- tests near the changed modules

## Risks And Boundaries

- Telegram Bot API is reliable enough for first IM support, but still an external network dependency. Automated tests should use a local HTTP stub, while completion requires a real manual smoke.
- Group chats can be noisy. V1 should require bot mention or reply in groups.
- Telegram raw chat ids are routing data, not model-authored parameters.
- S0084 must not add Telegram-specific branches to core channel logic. Provider-specific code stays inside the built-in extension.
