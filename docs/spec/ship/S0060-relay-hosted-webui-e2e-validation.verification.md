# S0060 Verification Note: Relay Hosted WebUI E2E

Date: 2026-06-06

## Result

S0060 passed.

M8 Relay is complete as of this verification. The successful path used real local processes, the real Relay protocol, the real Host runtime path, the real WebUI dev server, and a real LLM provider key from the local environment. No fake provider, fake Host, test-only Relay route, or hidden product branch was used.

## Commands

```bash
pnpm verify:m8-relay
pnpm typecheck && pnpm test
```

`pnpm verify:m8-relay` requires either `SCOREL_API_KEY` or `OPENAI_API_KEY` in the environment. The key value is never written to repository files or printed by the verifier.

## Real E2E Evidence

Last successful run:

```json
{
  "ok": true,
  "relayUrl": "ws://127.0.0.1:62939",
  "webuiUrl": "http://127.0.0.1:62940",
  "deviceId": "device_7dfab650-02bc-4b47-b482-8d29530d355e",
  "entryClientId": "client_webui_mq14pc91",
  "projectId": "prj_3e877eaa-501c-40de-9182-c5af57016b75",
  "sessionId": "ses_421b97e8-ec77-4b6b-b34c-d4d0b7db7316"
}
```

The verifier starts:

- a real local Relay process with durable file store
- a real local Host daemon process connected outbound to Relay
- a real WebUI Next dev server
- a temporary real Project using the device-level `~/.scorel/config.toml`
- a Relay Entry using `RelayTransport` and `DaemonClient`

The verifier then:

- creates a Relay pair session
- runs `pnpm scorel pair <pair-code> --relay <relay-url>` against the same temporary Host home
- confirms Relay lists the paired Device as online
- lists Host Projects through Relay
- creates a Session under the Host Project through Relay
- sends a real prompt through Relay to the Host runtime
- receives a real assistant event stream through Relay
- reconnects a fresh Entry client and resyncs the real Session through Relay
- checks the Host-owned JSONL contains the real prompt and preserves the WebUI Entry `clientId`
- checks Relay durable storage contains device/client/binding metadata
- checks Relay storage/logs do not contain prompt content
- restarts Relay and confirms durable bindings survive

## Bug Found During Validation

The first real S0060 run exposed a Relay presence bug:

- `scorel pair` opens a temporary Host socket using the same `deviceId` as the daemon Host.
- The old Relay presence model allowed only one socket per `deviceId`.
- When the pair socket closed, it removed the daemon Host presence and WebUI saw the Device as offline.

Fix:

- Relay presence now tracks a set of Host sockets per `deviceId`.
- Closing the pair socket no longer marks the daemon Host offline while the daemon socket remains open.
- Regression test: `keeps a daemon Host online when a second pair socket for the same device closes`.

## Acceptance Coverage

- Real hosted/WebUI Relay mode can pair with local Host: passed.
- WebUI dev server starts and serves `/settings`: passed.
- WebUI Entry identity is represented by the verifier's stable `client_webui_*` client id: passed.
- Relay displays the paired Device as online through `list_authorized_devices`: passed.
- Host Projects can be listed through Relay: passed.
- Session can be created under a Host Project through Relay: passed.
- Prompt can be sent through Relay and receives assistant events from a real provider: passed.
- Resulting Session JSONL is written under Host-owned state, not Relay storage: passed.
- `user_message.clientId` in JSONL is the WebUI Entry `clientId`: passed.
- WebUI refresh/reconnect equivalent resync through a fresh Relay Entry client: passed.
- Relay logs/store contain no prompt/tool/session payload: passed for prompt-content audit.
- Direct WS mode regression remains covered by the full workspace test suite.

## Notes

The verifier intentionally uses temporary `HOME`, Relay data, and Project directories so it does not mutate the engineer's real `~/.scorel` state. This still exercises the product defaults because the CLI resolves its state through `HOME`, not through test-only state flags.
