# S0094: IM Inbound Runtime

## Goal

Make built-in QQ and WeChat IM integrations actually receive user messages at runtime and route them through the shared Scorel IM session bridge.

## Scope

- Implement QQ Bot inbound receive through the official WebSocket Gateway.
- Implement WeChat inbound receive through an official HTTP callback surface for official-account style plaintext text messages.
- Keep WeCom group robot webhook as an outbound-only sender because that official webhook surface does not deliver user messages back to Scorel.
- Keep adapters platform-IO only. They call `ctx.onMessage(...)`; daemon session creation stays in the existing IM bridge.
- Update GUI settings and docs so outbound webhook configuration is not presented as if it enables inbound WeChat chat.

## Not In Scope

- Consumer personal WeChat reverse engineering, browser automation, or Web WeChat scraping.
- Hosted public ingress, TLS certificates, relay tunneling, or automatic public URL provisioning.
- Full WeChat encrypted callback decrypt/encrypt support. Plaintext callback is the S0094 receive baseline.
- QQ sharding beyond one local gateway connection.

## Acceptance Criteria

- QQ adapter `start(ctx)` fetches an access token, fetches `/gateway`, opens a WebSocket, identifies with `QQBot <access_token>`, sends heartbeats, and calls `ctx.onMessage(...)` for text dispatch events normalized by `normalizeQQEvent`.
- QQ adapter `stop()` closes the WebSocket and heartbeat timer.
- WeChat adapter starts a local HTTP callback server when callback config is present, responds to GET URL verification, accepts text POST callbacks, normalizes them, and calls `ctx.onMessage(...)`.
- WeChat adapter can still send outbound text to a configured WeCom group robot webhook; if only webhook URL is configured, inbound is explicitly not started.
- Tests cover QQ gateway identify/heartbeat/dispatch/stop and WeChat callback verification/message routing.

## Test Requirements

- Add focused adapter tests before implementation.
- Run:

```bash
pnpm --filter @scorel/daemon test -- qq-adapter.test.ts wechat-adapter.test.ts
pnpm typecheck
pnpm test
```

## Impacted Files

- `extensions/builtin/qq/adapter.js`
- `extensions/builtin/qq/adapter.d.ts`
- `extensions/builtin/wechat/adapter.js`
- `extensions/builtin/wechat/adapter.d.ts`
- `packages/daemon/src/qq-adapter.test.ts`
- `packages/daemon/src/wechat-adapter.test.ts`
- `apps/gui/src/renderer/settings/sections/ImSection.tsx`
- `docs/spec/ship/S0091-built-in-qq-and-wechat-im-extensions.md`

## Risks And Boundaries

- QQ event delivery also depends on the bot's platform-side event subscriptions and permissions. Scorel can connect to the gateway, but QQ may still omit events that are not enabled for the bot.
- WeChat callback receive requires a URL Tencent can reach. Local-only callback ports are useful for tunnels and tests, but are not publicly reachable by themselves.
- WeCom group robot webhook remains outbound-only by official product design; Scorel must not imply that it can receive user chat through that webhook.

## References

- QQ Bot event delivery and WebSocket gateway: <https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html>
- QQ Bot gateway URL API: <https://bot.q.qq.com/wiki/develop/api-v2/openapi/wss/url_get.html>
- WeCom group robot outbound webhook: <https://developer.work.weixin.qq.com/document/path/91770>
- WeChat official account callback verification and normal messages: <https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Access_Overview.html>, <https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Receiving_standard_messages.html>

## Status

Done.
