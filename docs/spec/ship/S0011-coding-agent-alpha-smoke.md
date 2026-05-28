# S0011: Coding Agent Alpha Smoke

## Goal

Validate M2 as a complete Coding Agent Alpha rather than a collection of isolated tools.

This is M2.4. It proves `scorel chat` can complete a small coding task in a real temporary repository using search, read, edit/write, bash verification, Todo progress, session persistence, and resume.

## Deliverable

- End-to-end real-provider coding smoke test.
- Strict config schema for pi-ai builtin/custom model selection.
- Fixed Scorel user root and session path: `~/.scorel` and `~/.scorel/sessions`.
- Temporary repository fixture with source files and a test command.
- Scripted task that requires `Glob` or `Grep`, `Read`, `Edit` or `Write`, `Bash`, and `Todo`.
- Assertions for CLI-visible tool output and Todo status changes.
- Assertions that tool calls, tool results, and Todo state persist to JSONL.
- Resume assertion that the latest context includes prior tool results and Todo state.

## Scenario

The smoke should use a small real workspace, for example:

1. User asks Scorel to fix a failing function.
2. Model creates a Todo list.
3. Model uses `Grep` or `Glob` to find the target file.
4. Model uses `Read` to inspect the file.
5. Model uses `Edit` or `Write` to change it.
6. Model uses `Bash` to run the relevant test.
7. Model marks Todo items complete.
8. CLI output shows tool calls, command result, and Todo transitions.
9. Session JSONL can be loaded again and used for resume.

## Scope

- Use pi-ai for real provider protocol handling in product validation.
- Keep fixed product paths out of config; config only covers variable model/provider settings.
- Keep pi-ai builtin models and custom compatible endpoints as separate config branches.
- Verify the full daemon/client/CLI path.
- Keep the fixture small and fast.
- Treat this spec as M2 completion proof.

## Not In Scope

- Mock-only or scripted fake-provider validation as completion proof.
- Broad benchmark suite.
- Permission approval, sandbox, checkpoint, remote daemon, MCP, GUI.
- Complex multi-file refactors.

## Acceptance Criteria

- The end-to-end smoke fails before the integrated real-provider M2 path is complete.
- The smoke passes after S0008, S0009, and S0010 are implemented.
- CLI output includes visible Todo transitions and tool progress/result output.
- JSONL contains the expected user message, assistant/tool events, and Todo state changes.
- Resume loads enough context for the model to continue from the completed task.
- `pnpm typecheck && pnpm test` passes.

## Config Shape

Builtin pi-ai model:

```toml
[model]
type = "builtin"
provider = "openai"
id = "gpt-5.4-mini"
apiKeyEnv = "SCOREL_API_KEY"
```

Custom compatible endpoint:

```toml
[model]
type = "custom"
api = "openai-completions"
provider = "chanleramp"
id = "gpt-5.4-mini"
baseUrl = "https://amp.chanler.dev/v1"
apiKeyEnv = "SCOREL_API_KEY"
contextWindow = 400000
maxTokens = 128000
reasoning = true
```

Supported custom `api` values for M2 are `openai-completions`, `openai-responses`, `google-generative-ai`, and `anthropic-messages`.

## Verification

- `pnpm --filter @scorel/app-cli test -- coding-agent-alpha`
- `pnpm --filter @scorel/core test -- tools`
- `pnpm --filter @scorel/daemon test`
- `pnpm --filter @scorel/client test`
- `pnpm typecheck && pnpm test`

## Affected Paths

- `apps/cli/`
- `apps/cli/src/index.test.ts`
- `packages/core/src/tools/`
- `packages/core/src/runtime/`
- `packages/daemon/`
- `packages/client/`
- `packages/protocol/src/`

## Risks

- A smoke that only checks isolated tool calls will not prove product value. It must go through CLI-visible daemon/client flow.
- A mock-only smoke can hide the product failure mode where `scorel chat` cannot actually call an LLM. Completion proof must include a real provider run.
- If resume is skipped, Scorel loses its product distinction from a disposable coding chat.
