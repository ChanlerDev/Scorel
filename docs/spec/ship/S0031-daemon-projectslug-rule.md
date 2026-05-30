# S0031: Daemon ProjectSlug Generation Rule

## Goal

Lock how `EmbeddedDaemon` generates the `projectSlug` it exposes to clients, so daemon-side identity becomes self-determined instead of opaque options pass-through.

S0026 / S0029 already require `projectSlug` to be a stable, daemon-owned identifier. Neither spec defines the string-construction rule. Today `EmbeddedDaemon` accepts `projectSlug?` as a constructor option and forwards it verbatim through handshake / event metadata / diagnostics; whatever the embed host hands in becomes the slug. That is fragile and forces every entry point (CLI / future remote daemon CLI / future GUI host) to invent the same rule independently.

This spec adopts the codebuddy-style rule (`/Users/chanler/personal/Scorel` → `Users-chanler-personal-Scorel`) inside `@scorel/daemon`, removes slug construction from embed hosts, and makes the slug deterministic from the daemon working directory.

## Scope

- Add `packages/daemon/src/projects/slug.ts` exporting:
  - `toProjectSlug(absolutePath: string): string`
  - `fromProjectSlug(slug: string): string | null` (best-effort `-` → `/` reverse with leading `/`; returns null if obviously invalid)
- Replace `EmbeddedDaemon` constructor option `projectSlug?: string` with `workDir: string`. The daemon computes `projectSlug = toProjectSlug(workDir)` internally.
- Keep `deviceId` / `deviceDisplayName?` constructor options unchanged.
- Update `apps/cli/src/index.ts` (every `EmbeddedDaemon` instantiation) to pass `workDir` instead of `projectSlug`.
- Keep handshake / event metadata / diagnostics shapes unchanged: they continue to carry `projectSlug` over the wire.
- Slug rule:
  1. Resolve input to absolute path. POSIX paths only on day one (Windows pass-through ok, but documented as best-effort: drive letter `:` removed, `\` and `/` both treated as separator).
  2. Strip leading `/`.
  3. Replace every remaining `/` with `-`.
  4. Empty input → throw; `/` (root) → `root` (single segment fallback).
  5. No hashing, no URL-encoding, no truncation.

## Not In Scope

- Changing `~/.scorel/sessions/` directory layout. Sessions remain flat; per-S0029 "do not move existing files".
- Daemon-side `list_projects` / `list_sessions` protocol (lives in S0032).
- Reverse-lookup correctness when `-` appears inside a path segment. Daemon must persist `workDirHint` separately if it ever needs accurate reverse mapping (out of S0031 scope; covered by future spec when `list_projects` is added).
- WebUI / CLI client-side slug computation. Clients consume slugs from daemon, never compute them.
- TLS / auth / session creation behavior.

## Acceptance Criteria

- `packages/daemon/src/projects/slug.ts` exposes `toProjectSlug` with the rule above; unit tests cover:
  - `/Users/chanler/personal/Scorel` → `Users-chanler-personal-Scorel`
  - `/home/alice/repo` → `home-alice-repo`
  - `/` → `root`
  - empty / non-string → throws
  - relative paths get resolved to absolute through `path.resolve`; tests pin behavior with a `cwd` fixture
- `EmbeddedDaemonOptions.projectSlug` removed; `workDir: string` added and required.
- All `EmbeddedDaemon` constructions in `apps/cli/src/index.ts` and tests pass `workDir`. No CLI-side slug construction remains.
- `connect` result, `connected` daemon message, `client_connected` diagnostics all carry the daemon-computed `projectSlug`.
- `pnpm typecheck && pnpm test` passes.
- Manual check: start `scorel chat --cwd /tmp/scorel-fixture-foo-bar`; resulting connection reports `projectSlug: "tmp-scorel-fixture-foo-bar"`.

## Tests

- New unit tests `packages/daemon/src/projects/slug.test.ts` cover the rule cases above plus idempotence (`toProjectSlug(toProjectSlug(p))` is identity for clean inputs that contain no `-`).
- Update `packages/daemon` integration / embedded daemon tests to construct with `workDir` and assert the emitted `projectSlug` matches the rule.
- Update `apps/cli` tests where `EmbeddedDaemon` is instantiated.
- Run `pnpm typecheck && pnpm test`.

## Affected Paths

- `packages/daemon/src/projects/slug.ts` (new)
- `packages/daemon/src/projects/slug.test.ts` (new)
- `packages/daemon/src/index.ts`
- `packages/daemon/src/index.test.ts` (if present)
- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`
- `docs/spec/daemon.md` (note the slug rule, point at `slug.ts`)
- `docs/ROADMAP.md` (M5 step entry for S0031)

## Risks And Boundaries

- Hosts that previously fed exotic `projectSlug` values lose that hook. Acceptable: per S0026 the slug must be daemon-owned; no production caller relies on a non-path slug.
- `-` collisions (`/pi-mono` vs `/pi/mono`) are accepted; daemon must never reverse a slug to derive identity. Display layer keeps `workDirHint` separately when displaying paths (introduced alongside `list_projects` in S0032, not S0031).
- Windows: day-one rule is best-effort. If the project ever runs on native Windows, a follow-up spec hardens the rule; not blocking M5.
- Slug changes if a project gets moved on disk. Acceptable v1: the daemon-side identity tracks current `workDir`; clients invalidate cache on new slug like any other identity change.
