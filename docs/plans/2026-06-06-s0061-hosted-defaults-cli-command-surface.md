# S0061 Hosted Defaults And CLI Command Surface Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Scorel's CLI match the hosted Relay/WebUI product path: `scorel` is the default project entry, `scorel host serve` starts and registers the local Host, `scorel pair` defaults to the official Relay, and `scorel relay serve` runs a self-hosted Relay.

**Architecture:** Keep Host authority in `@scorel/daemon` and Relay routing in `apps/relay`; the CLI only renames and composes existing capabilities. Add hosted defaults in CLI-facing modules without removing self-hosted overrides. Preserve `daemon` and `chat` aliases during pre-1.0 while documenting `host` and no-subcommand `scorel` as primary.

**Tech Stack:** TypeScript, Node.js, `ws`, Vitest, existing `@scorel/client`, `@scorel/daemon`, `@scorel/protocol`.

---

### Task 1: Hosted Default Constants

**Files:**
- Modify: `apps/cli/src/relay-cli.ts`
- Modify: `apps/cli/src/daemon-cli.ts`

**Steps:**

1. Add constants for official hosted URLs:
   - WebUI origin: `https://scorel.chanler.dev`
   - Relay URL default: `wss://scorel-relay.chanler.dev`
2. Let `SCOREL_RELAY_URL` override the Relay default.
3. Use the default in pair and host serve paths.

### Task 2: Pair Defaults

**Files:**
- Modify: `apps/cli/src/relay-cli.ts`
- Modify: `apps/cli/src/relay-cli.test.ts`

**Steps:**

1. Update failing tests so `scorel pair <code>` no longer errors when `--relay` is omitted.
2. Add parser coverage for explicit `--relay`.
3. Implement default Relay resolution.
4. Keep self-hosted integration tests using explicit local Relay URLs.

### Task 3: Host Command Alias And Serve Semantics

**Files:**
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/daemon-cli.ts`
- Modify: `apps/cli/src/index.test.ts`

**Steps:**

1. Route `scorel host ...` to the daemon/Host command implementation.
2. Rename usage output to prefer `host`.
3. Add `--no-relay`, `--relay <url>`, and `--replace` to `host serve`.
4. Default `host serve` to Relay on, registering current cwd as initial Project.
5. Keep stale/dead state cleanup behavior as-is; reject live Host unless `--replace` is passed.
6. Implement `--replace` by stopping live existing Host before starting the new one.

### Task 4: Default Interactive Command

**Files:**
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/index.test.ts`

**Steps:**

1. Add no-subcommand `scorel` dispatch to the same interactive path as `scorel chat`.
2. Preserve explicit `scorel chat`.
3. Ensure known command parse errors still render usage/errors instead of falling into chat unexpectedly.

### Task 5: Relay Operator Command

**Files:**
- Modify: `apps/cli/src/index.ts`
- Create or modify: `apps/cli/src/relay-server-cli.ts`
- Modify: `apps/relay/src/index.ts` if needed for reusable start helpers
- Add tests in `apps/cli/src/*.test.ts`

**Steps:**

1. Add `scorel relay serve` as the CLI surface for local/self-hosted Relay.
2. Parse `--host`, `--port`, and `--data-dir`.
3. Start the existing Relay server with `FileRelayStore`.
4. Keep the command long-running until signal/abort in production and testable through an injected abort signal.

### Task 6: Docs And Verification

**Files:**
- Modify: `docs/SHIP.md`
- Modify: `docs/ROADMAP.md`
- Modify: `README.md`
- Modify: `docs/README.md` if command references require it
- Modify: `docs/spec/relay.md` if command examples are stale

**Steps:**

1. Update quickstarts to prefer `scorel`, `scorel host serve`, hosted WebUI, and default `scorel pair`.
2. Mark S0061 Done only after implementation and tests pass.
3. Run:
   - `pnpm --filter @scorel/app-cli test`
   - `pnpm --filter @scorel/relay test`
   - `pnpm typecheck`
   - `pnpm test`
4. Run `git diff --check`.
