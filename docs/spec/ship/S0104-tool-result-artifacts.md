# S0104: Tool Result Artifacts

## Goal

Keep long tool results useful without letting them dominate model context.

When a tool result is too large, Scorel should preserve the full result as a session-owned artifact and put only a compact, actionable projection in the model-facing tool result.

## Scope

- Add a session-owned artifact path for oversized tool results:

```text
~/.scorel/sessions/{sessionId}.artifacts/{toolCallId}/result.txt
```

- Start with `Bash` stdout/stderr because it is the highest-risk long-output source.
- Preserve the full command result in `result.txt`, including exit code, cwd, stdout, and stderr.
- Return a compact tool result containing:
  - exit code;
  - cwd;
  - full artifact path;
  - complete result byte count;
  - stdout/stderr byte counts;
  - a budgeted head/tail projection of the oversized streams.
- Treat `maxOutputBytes` as the total projection snippet budget across stdout/stderr, not as a per-stream head/tail allowance. For example, a 16,000-byte projection budget should not turn into 16,000 bytes of stdout head plus 16,000 bytes of stdout tail plus the same again for stderr.
- Keep session JSONL append-only. Do not rewrite or delete old tool result events.
- Keep diagnostics free of full prompt text and full tool results.
- Keep Relay and attach-cache out of this storage path.

## Not In Scope

- Background Bash, task id, poll, stop, or monitor semantics.
- Artifact retention policy, compression, upload, or remote retrieval.
- Rewriting existing session JSONL files.
- Applying artifact projection to `Read`, `Grep`, `Glob`, or MCP tools.
- Provider-specific token accounting.

## Acceptance Criteria

- `Bash` output at or below the existing output limit behaves as before.
- `Bash` output above the limit writes the complete result to `result.txt`.
- Oversized `Bash` model-facing content includes the artifact path, `resultBytes`, and budgeted head/tail snippets instead of only the leading bytes.
- The artifact file contains the complete stdout/stderr text, not only the projected snippets.
- The tool result details expose artifact metadata for UI/diagnostics without requiring it to enter rebuilt model context.
- Existing `buildContext()` behavior still strips tool execution details from replayed model context.
- `pnpm --filter @scorel/core test -- src/tools/coding-tools.test.ts`
- `pnpm --filter @scorel/daemon test -- src/embedded/embedded.test.ts`
- `pnpm typecheck && pnpm test`

## Impacted Files

- `packages/core/src/tools/coding-tools.ts`
- `packages/core/src/tools/coding-tools.test.ts`
- `packages/core/src/session/index.ts`
- `packages/daemon/src/index.ts`
- CLI / GUI runtime creation paths that call `createRealRuntime`
- `docs/ROADMAP.md`

## Risks And Boundaries

- Full command output can contain secrets. The artifact path is local session data and must not be copied into diagnostics, attach-cache, or Relay.
- Head/tail snippets can still expose sensitive text. This is no worse than the current truncated result, but future permission policy should handle sensitive commands explicitly.
- Artifact paths are local to the daemon-owning machine. Remote clients can see the path as evidence, but remote file retrieval is a separate future protocol.
