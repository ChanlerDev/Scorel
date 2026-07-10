# S0117: GUI Context Usage Indicator

**Status**: In Progress

## Goal

Show provider-reported context usage beside the GUI send button so users can see the actual next-turn context load implied by the latest completed model request and when the session is approaching auto compact.

## Scope

- Add a compact circular context indicator in the composer action row, immediately left of the send button.
- Use the latest completed model response's uncached `usage.inputTokens + usage.outputTokens` as the authoritative used-context value. The input side represents the context actually submitted to the provider, such as system instructions, tools, messages, compact summaries, and other provider-counted input. The output side is included because that assistant output becomes part of the next turn's context.
- Do not include prompt-cache read/write tokens in context usage. If a provider reports cached token details separately, cache hits and cache writes are billing/efficiency metadata, not additional context-window occupancy.
- Keep the latest completed request's usage visible while the next request is streaming. Replace it only when a newer completed response reports usage.
- Use the selected model `contextWindow` as the total context size, falling back to the existing product default when model metadata is unavailable.
- Use `memory.autoCompactThreshold` for the black auto-compact threshold marker.
- Show a hover tooltip with used percent, remaining percent, used tokens, and total tokens.
- Color the used arc from neutral to warning to danger as usage grows.
- Treat missing provider usage as unavailable. Do not present a renderer text-length estimate as an actual token count.
- Align daemon auto-compact decisions with the same provider-reported context-token value so the displayed threshold and runtime behavior use one token source.

## Not In Scope

- Implementing a model-specific tokenizer in the GUI.
- Presenting text-length estimates as provider-reported usage.
- Showing historical cumulative usage or cost.
- Remote artifact retrieval, compaction controls, or manual compact UI.

## Data Contract

- `usedTokens` is the most recent provider-reported uncached `usage.inputTokens + usage.outputTokens` on the active session branch.
- `usage.inputTokens` must mean non-cache input tokens. If the provider separates cached input from uncached input, only the non-cache input portion contributes to `usedTokens`.
- `usage.outputTokens` contributes to `usedTokens` because completed assistant output is replayed into the next model request's context.
- `totalTokens` is the selected model's configured `contextWindow`, with the existing 200,000-token product fallback only when model metadata is unavailable.
- `usedPercent = min(usedTokens / totalTokens, 1)`.
- `remainingTokens = max(totalTokens - usedTokens, 0)` and `remainingPercent = max(1 - usedTokens / totalTokens, 0)`.
- `autoCompactThreshold` is the configured `memory.autoCompactThreshold`.
- The usage source is explicit: `provider_reported` or `unavailable`. Estimated values must not be labeled or rendered as actual usage.
- If no completed response on the active branch has provider usage, the indicator renders an unavailable state instead of `0%`.
- Cumulative `usage.totalTokens` and any cache-specific usage fields are not context usage and must not drive the indicator.

## Acceptance Criteria

- The indicator renders in both empty and active session composers.
- After a completed provider response reports usage, the tooltip shows the derived `inputTokens + outputTokens` context load, used percent, remaining percent, remaining tokens, and model context-window total.
- The ring shows used context, remaining context, and the auto-compact threshold marker.
- The threshold marker follows the configured `autoCompactThreshold` instead of a hard-coded value.
- The displayed used-token value exactly matches the latest completed response's provider-reported non-cache `usage.inputTokens + usage.outputTokens`; it is not derived from visible event text, cumulative billing usage, cache-read tokens, cache-write tokens, or `usage.totalTokens`.
- During streaming, the indicator retains the previous completed request's value and does not speculate about the in-flight request.
- A session with no provider-reported input usage shows an unavailable state and does not display a fabricated percentage or token count.
- Branch switching, session switching, replay, reconnect, and post-compact responses select the latest provider-reported usage from the active branch only.
- Daemon auto compact and the GUI threshold comparison use the same authoritative provider-reported context-token value when available.

## Tests

- Component tests cover provider-reported tooltip text, unavailable state, progress styling, and threshold marker.
- Renderer tests prove the value comes from the latest completed response's non-cache `usage.inputTokens + usage.outputTokens`, not event-text length, cache token fields, or `usage.totalTokens`.
- Renderer tests cover streaming retention, active-branch selection, session switching, reconnect/replay, missing usage, and post-compact usage replacement.
- Daemon tests prove auto compact compares the same provider-reported context-token value against `contextWindow * autoCompactThreshold`.
- `pnpm --filter @scorel/app-gui test -- Composer`
- `pnpm --filter @scorel/app-gui typecheck`
- `pnpm typecheck && pnpm test`

## Impacted Files

- `packages/daemon/src/index.ts`
- `packages/daemon/src/embedded/embedded.test.ts`
- `apps/gui/src/renderer/composer/Composer.tsx`
- `apps/gui/src/renderer/composer/Composer.test.tsx`
- `apps/gui/src/renderer/App.tsx`
- `apps/gui/src/renderer/workspace/SessionView.tsx`
- `apps/gui/src/renderer/workspace/Workspace.tsx`
- `apps/gui/src/renderer/workspace/EmptyState.tsx`
- `apps/gui/src/renderer/styles.css`
- `docs/ROADMAP.md`

## Risks And Boundaries

- Provider-reported usage is authoritative for the completed request but is unavailable before the first completed response and may be absent for providers that do not return usage.
- The latest completed request is intentionally stable while a new request is streaming; it is real but does not predict the in-flight request's final input usage.
- Provider usage schemas differ. Scorel's normalized `Usage` contract must not collapse cache-read/cache-write tokens into `inputTokens`; otherwise the context indicator and auto compact will overstate real context-window occupancy.
- Context token usage can exceed the configured context window if model metadata is wrong. The UI clamps visual percentages but preserves the reported token count.
- Missing model metadata should degrade to the existing 200,000 token default rather than hiding the control.
- The indicator must not make users think cumulative billing tokens are context-window usage.

## Delivery State

The current S0117 implementation commit delivers only the visual shell: the ring, hover tooltip, threshold marker, composer placement, and current component wiring. It is a partial implementation because its `usedTokens` value is still derived from renderer-side text-length estimation.

S0117 is complete only after the estimate is removed from the product path, provider-reported non-cache `usage.inputTokens + usage.outputTokens` drives the indicator, unavailable usage is represented honestly, daemon auto compact uses the aligned token source, and all acceptance tests above pass.
