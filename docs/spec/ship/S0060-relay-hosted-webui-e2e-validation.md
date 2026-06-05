# S0060: Relay Hosted WebUI E2E Validation

## Goal

Close M8 by proving the full Relay + hosted WebUI product path with real components:

```text
Hosted WebUI Entry -> Relay -> local Host -> Project -> Session -> Runtime
```

This spec validates that Relay is only a proxy/authorization registry and that Host remains the Project, Session, Runtime, JSONL, replay, and resync authority.

## Scope

- Run a real local Relay service.
- Run a real local Host connected outbound to Relay.
- Run WebUI in Relay connector mode.
- Pair WebUI Entry with Host using the real pair flow.
- Add or select a real local Project through Host.
- Create a Session through Relay-backed `DaemonClient`.
- Send a prompt using a real configured LLM provider.
- Observe persistent and transient events in WebUI.
- Refresh/reconnect WebUI and verify Host-owned resync.
- Stop/restart Relay and verify:
  - live sockets are lost
  - durable bindings survive if using the configured durable store
  - Host JSONL and Project Registry remain unaffected
- Audit Relay store/logs to verify no Project Registry, prompt, tool result, Session JSONL, provider response, or replay cache is stored.
- Update `docs/ROADMAP.md` M8 status to Done only if the real path passes.

## Non-Goals

- Add new Relay features beyond S0057-S0059.
- Add accounts or OAuth.
- Add hosted execution.
- Add desktop GUI.
- Add SSH bootstrap.
- Add HTTP API.
- Introduce fake provider, fake Host, or test-only Relay route.

## Contract

The successful product path is:

```text
WebUI loads stable clientId
WebUI creates pair code
User runs scorel pair <code>
Host connects outbound to Relay
WebUI opens RelayTransport to deviceId
DaemonClient.connect succeeds
WebUI syncs Projects from Host
WebUI creates Session under Project
WebUI sends prompt
Host writes user_message.clientId to JSONL
Host runs Runtime in Project cwd
WebUI receives event stream through Relay
WebUI refreshes and resyncs from Host
```

Relay must only contain:

```text
devices
clients
bindings
presence
pair sessions
routing metadata
```

Relay must not contain user workspace content.

## Acceptance Criteria

- Real hosted/WebUI Relay mode can pair with local Host.
- WebUI displays the paired Relay Device as online.
- WebUI can list Host Projects through Relay.
- WebUI can create a Session under a Project through Relay.
- WebUI can send a prompt through Relay and receive the assistant event stream.
- The resulting Session JSONL is written under Host-owned `~/.scorel`, not Relay storage.
- `user_message.clientId` in JSONL is the WebUI Entry `clientId`.
- WebUI refresh can recover via existing `DaemonClient` resync through Relay.
- Relay logs and store contain no prompt/tool/session payload.
- Direct WS mode still works after Relay changes.
- `pnpm typecheck && pnpm test` passes.
- ROADMAP marks M8 Done only after this validation passes.

## Test Requirements

- Add an executable relay e2e script or documented manual test path that starts:
  - Relay
  - Host outbound Relay connection
  - WebUI
  - real LLM provider configuration
- Prefer automation for pair/list/create/send/resync where practical.
- Manual verification is acceptable for browser-only UI steps, but must record exact commands and expected evidence in the spec or an M8 verification note.
- No mock/fake provider is accepted as M8 completion proof.
- Run:

```bash
pnpm typecheck
pnpm test
```

Plus the real relay hosted WebUI e2e command or manual checklist defined during implementation.

## Affected Paths

- `apps/relay/*`
- `apps/cli/*`
- `apps/webui/*`
- `packages/client/*`
- `packages/daemon/*`
- `packages/protocol/*`
- `docs/ROADMAP.md`
- optional `docs/spec/ship/S0060-*.verification.md` or `self/discussions/*` for local evidence before docs sync

## Risks

- Passing unit tests can still miss the real hosted workflow. M8 closure requires real components.
- Relay logs may accidentally include payload bodies. Audit logs and store files directly.
- WebUI may pass through Relay but still use stale direct connector cache. Explicitly verify connector kind and `deviceId` cache scope.
- Real provider configuration may be unavailable in CI. Keep the manual real-provider checklist explicit.
