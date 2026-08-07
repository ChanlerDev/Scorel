# S0119: pi-ai Upgrade And Public Eval Template

## Goal

Upgrade Scorel to the maintained pi-ai package with native, distinct `xhigh`
and `max` reasoning levels, and make the public Harbor / Terminal-Bench adapter
safe and convenient for other users to run with their own provider connection.

## Scope

- Replace deprecated `@mariozechner/pi-ai` 0.73.1 with the current
  `@earendil-works/pi-ai` 0.84.1 release.
- Migrate model catalog lookup and API streaming to the maintained package's
  non-compat entrypoints.
- Preserve `xhigh` and `max` as distinct Scorel values and provider payloads.
- Retry one prematurely ended OpenAI-compatible reasoning stream before it
  emits visible answer text; never accept a truncated stream as complete.
- Use current official GPT-5.6 and Claude 5 prices, including cache writes and
  GPT-5.6 per-request long-context tiers.
- Terminate Background Bash process groups on ordinary Host shutdown while
  preserving them only for the explicit headless verifier handoff.
- Warn timed headless runs to finalize their best artifact before the deadline.
- Publish an ignored `.env` workflow with a placeholder-only `.env.example`.
- Publish a Terminal-Bench launcher with configurable dataset, sandbox,
  attempts, concurrency, model, protocol, and reasoning effort.
- Scrub provider label, base URL, and API key from Harbor job files before any
  optional private upload.
- Document the public adapter's capabilities, setup, outputs, and privacy
  boundary.

## Not In Scope

- Committing any real provider identity, endpoint, credential, or local job.
- Making Scorel responsible for Harbor installation or Daytona authentication.
- Publicly uploading benchmark jobs or leaderboard submissions.
- Automatically selecting a reasoning effort for a model.

## Acceptance Criteria

- No source or lockfile reference to the deprecated pi-ai package remains.
- `xhigh` produces the provider value `xhigh`; `max` produces `max`.
- Existing provider, runtime, CLI, daemon, GUI, and package build checks pass.
- A user can copy `eval/.env.example` to ignored `eval/.env` and launch the
  adapter without editing tracked source.
- The launcher forwards connection values through Harbor agent kwargs and the
  adapter forwards them through Scorel CLI flags.
- The launcher defaults to two attempts and at most three concurrent trials,
  while allowing public-safe local overrides.
- Private upload is opt-in, always uses Harbor's `--private` mode, and happens
  only after successful secret scrubbing.
- Tracked eval files contain placeholders only.

## Testing Requirements

- Provider request tests assert distinct `xhigh` and `max` payload values.
- Existing Scorel typecheck and tests pass against pi-ai 0.84.1.
- Harbor adapter and scrubber unit tests pass.
- Shell syntax, Python compilation, package build, and package smoke tests pass.
- A scoped privacy scan covers every staged file before commit.

## Impacted Files And Packages

- root and `packages/core` dependency manifests and lockfile
- `packages/core/src/provider/pi-ai.ts` and provider tests
- pi-ai TypeBox imports in core and daemon tests
- package and GUI runtime build assertions
- reasoning effort CLI, GUI, protocol, persistence, docs, and tests
- `eval/**` public adapter, launcher, scrubber, environment template, and docs

## Risks And Boundaries

- pi-ai 0.83.0 replaced its old global registry with explicit catalog and API
  entrypoints; Scorel must not depend on the temporary `/compat` entrypoint.
- pi-ai 0.84.1 adds the current GPT-5.6 and Claude 5 catalogs and native `max`
  mappings. A missing terminal `finish_reason` still represents a truncated
  stream and must not be normalized into success.
- Extended reasoning levels remain model/provider capabilities. Explicit
  Scorel `xhigh` and `max` selections preserve the requested provider value;
  provider rejection remains visible rather than silently changing the level.
- Harbor persists agent kwargs. Ignoring `.env` alone is insufficient, so job
  files must be scrubbed before upload.
- Model identifiers remain in evaluation output because they are required to
  interpret a benchmark; connection identity and credentials do not.
