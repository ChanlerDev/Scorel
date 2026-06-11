# S0063: AI Release Notes

## Goal

Make every normal Scorel release produce transparent, user-readable changelog notes by default. The notes are generated from the commits since the previous `v*` release tag using DeepSeek V4 Flash, then inserted into `docs/CHANGELOG.md` before the release commit is created.

## Scope

- Add a release-notes generator that:
  - finds commits in a supplied release range
  - collects commit file names and diff stats before collecting patches
  - skips generated files such as `dist/`, source maps, lockfiles, `.next/`, and `node_modules/` before reading patch content
  - summarizes each commit as structured JSON evidence
  - aggregates commit summaries into release-level structured JSON
  - renders Markdown suitable for `docs/CHANGELOG.md`
- Use DeepSeek official Chat Completions endpoint:
  - default base URL: `https://api.deepseek.com/v1`
  - default model: `deepseek-v4-flash`
  - API key env: `DEEPSEEK_API_KEY`
  - non-thinking request: `thinking: { "type": "disabled" }`
  - JSON mode: `response_format: { "type": "json_object" }`
- Treat `docs/spec/ship/S*.md` diffs as important product context in the system prompt, without parsing spec structure.
- Make `pnpm release <patch|minor|major>` generate notes by default.
- Add `--no-generate-notes` as the explicit release escape hatch.
- Add a standalone preview/debug command:

```bash
pnpm release-notes --from v0.0.1 --to HEAD --version 0.0.2
```

- Update the manual GitHub Actions release workflow so CI releases use the same default notes behavior and can disable it explicitly.

## Non-Goals

- Do not build a full release management product.
- Do not parse SHIP spec sections such as Goal, Scope, or Acceptance Criteria in S0063.
- Do not publish GitHub Releases in S0063.
- Do not require AI release notes when the operator explicitly passes `--no-generate-notes`.
- Do not use mock provider behavior as proof for any real product path. Script unit tests may use injected fetch and git runners.

## Contract

### Default Release

```bash
pnpm release patch
```

must:

- compute the next version from the current package version
- find the previous `v*` tag for the release range
- generate AI release notes before mutating versions
- insert rendered notes under `## Unreleased` in `docs/CHANGELOG.md`
- continue the existing verification, version bump, build, pack smoke, commit, tag, publish, and push path

### Explicit Skip

```bash
pnpm release patch --no-generate-notes
```

must preserve the previous minimal changelog section behavior.

### Dry Run

```bash
pnpm release patch --dry-run
```

must print the generated release notes preview when DeepSeek credentials are available. If credentials are missing or DeepSeek fails during dry run, the script may print a deterministic fallback preview and continue.

### Standalone Preview

```bash
pnpm release-notes --from v0.0.1 --to HEAD --version 0.0.2
```

must print Markdown notes only. It must not bump versions, write files, create commits, tag, publish, or push.

## Acceptance Criteria

- `scripts/release-notes.mjs` exists and can be used as both an importable module and a CLI.
- Root `package.json` includes `release-notes`.
- Commit summary and release aggregation prompts require strict JSON output and mention SHIP specs as important context.
- DeepSeek requests use `https://api.deepseek.com/v1` and `deepseek-v4-flash` by default, with large output token limits appropriate for a high-context release task.
- Generated diffs are skipped before patch reads, so release-note collection does not depend on reading large bundled artifacts into a Node child-process buffer.
- Oversized non-generated diffs are truncated before being sent to the model.
- `scripts/release.mjs` generates notes by default and supports `--no-generate-notes`.
- `.github/workflows/release.yml` exposes a `generate_notes` input that defaults to true and passes `DEEPSEEK_API_KEY` for release-note generation.
- `docs/CHANGELOG.md` receives a full Markdown release section when notes generation is enabled.
- `docs/ROADMAP.md` lists S0063 as Done after implementation and verification.

## Test Requirements

Run:

```bash
node --test scripts/release-notes.test.mjs
pnpm release-notes --from v0.0.1 --to HEAD --version 0.0.2
pnpm release patch --dry-run
pnpm typecheck
pnpm test
git diff --check
```

The standalone `pnpm release-notes` command may require `DEEPSEEK_API_KEY` for the AI path. Tests must cover the deterministic collector, prompt payload, Markdown renderer, changelog insertion, and dry-run fallback behavior without calling the real API.

Collector tests must cover a commit that changes generated files plus a real release script file, and assert that the collector never calls `git show --patch` for generated files or for the whole commit patch.

## Affected Paths

- `package.json`
- `scripts/release.mjs`
- `scripts/release-notes.mjs`
- `scripts/release-notes.test.mjs`
- `.github/workflows/release.yml`
- `docs/SHIP.md`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/spec/ship/S0063-ai-release-notes.md`
- `docs/superpowers/plans/2026-06-08-s0063-ai-release-notes.md`

## Risks

- AI may overstate work. Mitigate with commit-level evidence, strict JSON validation, conservative prompts, and explicit handling of SHIP specs as context rather than proof of shipped behavior.
- Large diffs can exceed practical request size, and generated bundle diffs can exceed Node child-process output buffers before the model is called. Exclude generated files before patch reads, then truncate oversized non-generated patches while preserving file names and diff stats.
- Release should not silently ship empty notes. Formal releases fail on AI generation errors unless `--no-generate-notes` is explicit; dry-run can fall back for preview.
- DeepSeek API shape may drift. Keep base URL, model, and token limits configurable through environment variables.
