# Scorel

Single-user, local-first, desktop LLM agent client (macOS).

## Tech Stack

- **Runtime**: Electron (main + preload + renderer)
- **Language**: TypeScript (strict mode)
- **UI**: React
- **Database**: SQLite (better-sqlite3) + FTS5
- **IPC**: stdio JSONL (Core ↔ Runner)
- **Provider**: OpenAI Chat Completions (including OpenAI-compatible) + Anthropic Messages
- **Package Manager**: pnpm
- **Test**: Vitest + Playwright (E2E)
- **Lint**: ESLint + Prettier
- **Build**: electron-builder

## Project Structure

```
src/
  main/                  # Electron main process
    core/                # Orchestrator: context assembly, tool loop, compact
      orchestrator.ts
      session-manager.ts
      compact.ts
      tool-dispatch.ts
    provider/            # Provider registry + adapters
      openai-adapter.ts
      anthropic-adapter.ts
      transform-messages.ts
      event-stream.ts
      compat.ts
      types.ts
    storage/             # SQLite, event log, FTS, compactions
      db.ts
      event-log.ts
      compactions.ts
      migrations/
    runner/              # Tool runner process management
      runner-manager.ts
      mock-runner.ts
    skills/              # Skill loader (two-layer injection)
      skill-loader.ts
    security/            # Keychain, permission, redaction
      keychain.ts
      permission.ts
  preload/               # contextBridge minimal API
    index.ts
  renderer/              # React UI
    components/
    hooks/
    stores/
  shared/                # Types, constants shared across processes
    types.ts
    events.ts
    constants.ts
runner/                  # Standalone runner process (stdio JSONL)
  index.ts
  tools/
    bash.ts
    read-file.ts
    write-file.ts
    edit-file.ts
skills/                  # SKILL.md files
docs/
  V0_SPEC.md
  COMPAT.md
tests/
  unit/
  integration/
  e2e/
  golden/                # Recorded JSONL for replay tests
```

## Coding Conventions

- All code in TypeScript strict mode; no `any` unless interfacing with external untyped APIs
- Use `type` over `interface` for data shapes; `interface` only for implementable contracts
- File naming: kebab-case (`session-manager.ts`)
- Export naming: PascalCase for types/classes, camelCase for functions/variables
- Prefer pure functions for data transformations (especially protocol conversion)
- Error handling: never swallow errors silently; tool errors must become `ToolResultMessage` with `isError: true`
- No default exports

## V0 Scope Red Lines

These are hard boundaries. Do NOT implement in V0:

- MCP integration (only reserve extension points in types)
- Vector/embedding search (only reserve `embeddings` table schema)
- Auto compact / handoff (only reserve state machine placeholders)
- Multi-window concurrent write conflict resolution
- Plugin ecosystem / third-party skill distribution
- Server-side / team collaboration features

## Security Invariants

- `contextIsolation: true` + `sandbox: true` on all renderers — non-negotiable
- Provider API keys stored in macOS Keychain only; renderer never receives stored plaintext secrets; secret submission is write-only (storeSecret/hasSecret/clearSecret — no getSecret API)
- Runner executes in isolated child process; workspace path whitelist enforced
- All `write_file` / `edit_file` / `bash` require user approval by default
- `read_file` allowed by default but scoped to workspace root
- Workspace must be explicitly selected at session creation; no default to home directory
- Log redaction: mask Authorization headers, tokens, home/user paths in exports

## Git Conventions

- Branch: `feat/xxx`, `fix/xxx`, `refactor/xxx`, `docs/xxx`
- Commit messages: English, imperative mood, concise
- PR: English title, Chinese description OK
- No force push to `main`

## Key Design Decisions

- Message model aligns with pi-ai's `Message/Context/StopReason/AssistantMessageEvent`
- Canonical message model + `transformMessages()` for cross-provider conversion
- `assistant.content` always sent as string to OpenAI (not content-part array) — prevents recursive nesting bug (pi #2007)
- Anthropic: system extracted to top-level param; tool_results regrouped into user messages; tool_call_id normalized to 64 chars
- Normalized `AssistantMessageEvent` stream — UI and persistence are provider-agnostic
- Tool result `content/details` separation: content = model-facing, details = UI-facing structured metadata
- Runner uses stdio JSONL protocol (recordable, replayable, MCP-aligned)
- Storage: SQLite + EventLog JSONL dual-write; single writer thread; WAL mode
- Non-destructive manual compact: compaction record + boundary; messages table never mutated
- Compact: micro_compact (replace old tool_result with placeholder, KEEP_RECENT=3 turns) + manual compact (serialize + summarize + boundary record)
- IDs: `nanoid(21)` for all entities (session, message, event)
- Message ordering: `messages.seq` (monotonic per session) is authoritative; `ts` is informational
- Workspace: single directory per session, all file tools scoped to it
- Parallel tool calls: V0 executes sequentially; parallel reserved for Beta
- Tool output truncation at Runner level (bash: 32k chars, read_file: 64k chars)
- Core-owned tool timeout: Core is authoritative; Runner only responds to abort
- Aborted assistant: persisted if visible output existed, excluded from future LLM context
- Write-only secret submission: renderer collects key transiently, stores via write-only IPC, no read API

## Reference

- [Milestones](docs/milestones.md) — Master roadmap (V0 → V1.x)
- [V0 Spec](docs/V0_SPEC.md) — V0 architecture, data model, storage, protocols
- [Compat Strategy](docs/COMPAT.md) — Canonical model invariants, provider adapter mappings, pitfall registry
- Milestone specs: [M1](docs/V0-M1.md) | [M1.5](docs/V0-M1.5.md) | [M2](docs/V0-M2.md) | [M3](docs/V0-M3.md) | [M4](docs/V0-M4.md) | [M5](docs/V0-M5.md)
