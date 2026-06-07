# S0063 AI Release Notes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add DeepSeek-backed AI release notes that run by default during Scorel releases and can be previewed locally.

**Architecture:** `scripts/release-notes.mjs` owns git evidence collection, commit-level summarization, release aggregation, Markdown rendering, and changelog insertion helpers. `scripts/release.mjs` stays the release orchestrator and calls the notes module before version mutation unless `--no-generate-notes` is passed.

**Tech Stack:** Node.js 22 ESM, `node:test`, git CLI, DeepSeek Chat Completions over `fetch`, pnpm scripts, GitHub Actions.

---

## Chunk 1: Spec And Tests

### Task 1: Write the SHIP spec and plan

**Files:**
- Create: `docs/spec/ship/S0063-ai-release-notes.md`
- Create: `docs/superpowers/plans/2026-06-08-s0063-ai-release-notes.md`

- [x] Add the S0063 implementation contract.
- [x] Keep spec parsing out of scope; treat spec diffs as normal commit evidence plus prompt context.

### Task 2: Write failing release-notes tests

**Files:**
- Create: `scripts/release-notes.test.mjs`
- Modify: `package.json`

- [x] Test generated-file filtering and patch truncation.
- [x] Test DeepSeek request payload defaults: base URL, model, JSON mode, disabled thinking, and large `max_tokens`.
- [x] Test Markdown rendering omits empty sections.
- [x] Test changelog insertion under `## Unreleased`.
- [x] Run `node --test scripts/release-notes.test.mjs` and confirm RED.

## Chunk 2: Release Notes Module

### Task 3: Implement release-notes helpers

**Files:**
- Create: `scripts/release-notes.mjs`

- [x] Export collector, summarizer, aggregator, renderer, changelog insertion, and CLI helpers.
- [x] Use injected `runGit` and `fetch` in tests.
- [x] Default `DEEPSEEK_BASE_URL` to `https://api.deepseek.com/v1`.
- [x] Default `DEEPSEEK_MODEL` to `deepseek-v4-flash`.
- [x] Use a large default output token limit through `DEEPSEEK_MAX_TOKENS`, defaulting to `32768`.
- [x] Run `node --test scripts/release-notes.test.mjs` and confirm GREEN.

## Chunk 3: Release Integration

### Task 4: Wire default generation into release

**Files:**
- Modify: `scripts/release.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`

- [x] Add `--no-generate-notes` release flag.
- [x] Generate notes during dry-run and real release by default.
- [x] Keep previous changelog header behavior only for `--no-generate-notes`.
- [x] Add `release-notes` package script.
- [x] Add GitHub Actions `generate_notes` input and `DEEPSEEK_API_KEY` env.

## Chunk 4: Docs And Verification

### Task 5: Sync docs and run checks

**Files:**
- Modify: `docs/SHIP.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/CHANGELOG.md`

- [x] Document default release-note generation and skip flag.
- [x] Add S0063 to roadmap as Done after verification.
- [x] Add an Unreleased changelog item for AI release notes.
- [x] Run `node --test scripts/release-notes.test.mjs`.
- [x] Run `pnpm release patch --dry-run` with fallback behavior if no key is available.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm test`.
- [x] Run `git diff --check`.
