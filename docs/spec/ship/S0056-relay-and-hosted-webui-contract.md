# S0056: Relay And Hosted WebUI Contract

## Goal

Lock the next product-stage contract for Relay + hosted WebUI before implementation:

- Relay is an authenticated proxy and authorization registry, not a hosted daemon.
- Hosted WebUI can connect to user Devices through Relay without requiring public daemon exposure.
- Device -> Project -> Session remains the product hierarchy.
- Existing daemon wire payloads stay Host-owned; Relay only adds routing and authorization around the transport.

## Scope

- Add `docs/spec/relay.md` as the abstract Relay contract.
- Add ADR-007 to lock Relay proxy, `deviceId -> clientId` binding, and no new JSONL actor field.
- Update architecture docs to show Relay as a transport/control-plane extension.
- Update client spec to include `RelayTransport` and multi-connector Device semantics.
- Document the implementation directory boundary: `apps/relay` for the deployable service, shared types in `packages/protocol`, `RelayTransport` in `packages/client`, Host outbound adapter in `packages/daemon`.
- Update roadmap so Relay + Hosted WebUI becomes the next M stage and GUI/SSH/HTTP move after it.
- Create the first M8 implementation specs: S0057 through S0060.

## Non-Goals

- Implement Relay service code.
- Implement `RelayTransport`.
- Implement `scorel pair`.
- Implement hosted WebUI pairing UI.
- Add user accounts.
- Add hosted execution.
- Change JSONL schema.
- Add `entryId` or `routeId` to daemon events.

## Contract

Relay durable state:

- device identity metadata
- client/Entry identity metadata
- authorization bindings: `deviceId -> clientId`

Relay transient state:

- pair sessions
- online presence
- socket routing

Relay forbidden state:

- Project Registry
- Session JSONL
- prompts
- tool results
- provider responses
- replay / resync cache
- Runtime diagnostics that include user content

Transport contract:

```text
Direct:
  DaemonClient -> WsTransport -> Host

Relay:
  DaemonClient -> RelayTransport -> Relay -> Host relay adapter -> Host
```

`clientId` remains the daemon protocol and JSONL field for the Entry that authored user actions. Relay docs may use Entry as a product concept, but V1 does not introduce a separate `entryId` field.

## Acceptance Criteria

- `docs/spec/relay.md` defines Relay roles, state boundaries, pairing, routing, WebUI multi-device model, and reconnect semantics.
- ADR-007 explains why Relay is proxy + authorization registry instead of hosted daemon.
- Relay directory layout is explicit and does not introduce a top-level `relay/` directory or premature `packages/relay`.
- S0057-S0060 exist and split M8 into Relay service skeleton, Host outbound pairing, Entry/WebUI connector, and real e2e validation.
- `docs/ROADMAP.md` makes Relay + Hosted WebUI the next M stage.
- `docs/architecture.md` points to the Relay spec and does not imply Relay owns Scorel domain state.
- `docs/spec/client.md` describes `RelayTransport` as a transport adapter over the existing `DaemonTransport` contract.
- `docs/README.md` links the new Relay spec and ADR.

## Test Requirements

Docs-only spec. Verification is document consistency:

- grep for Relay references across docs.
- inspect changed docs for conflicting `entryId` / `clientId` semantics.
- no code tests required.

## Affected Paths

- `docs/spec/relay.md`
- `docs/decisions/007-relay-proxy-and-entry-routing.md`
- `docs/spec/ship/S0056-relay-and-hosted-webui-contract.md`
- `docs/architecture.md`
- `docs/spec/client.md`
- `docs/ROADMAP.md`
- `docs/README.md`
- `docs/spec/ship/S0057-relay-service-protocol-skeleton.md`
- `docs/spec/ship/S0058-host-outbound-relay-and-pair-command.md`
- `docs/spec/ship/S0059-relay-transport-and-hosted-webui-connector.md`
- `docs/spec/ship/S0060-relay-hosted-webui-e2e-validation.md`

## Risks

- Over-expanding Relay into a cloud backend would dilute Scorel's Host authority model.
- Treating Relay as just a URL alias would miss authorization, multi-device routing, and hosted WebUI requirements.
- Introducing new identity fields too early would churn JSONL and daemon protocol without product value.
