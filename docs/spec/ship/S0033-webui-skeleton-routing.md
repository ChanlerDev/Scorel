# S0033: WebUI Application Skeleton And Routing

## Goal

Stand up `apps/webui` as a Next.js 14 App Router project with Tailwind 4, wire it into the pnpm monorepo, and lock the URL routing surface for the rest of M5. No real data, no daemon connection — just a deployable empty shell with the right shape.

This spec exists separately from M5.4+ because the previous M5 attempt lumped framework integration with feature work, which hid build/ESM regressions inside feature commits. This time the skeleton lands first, alone.

## Scope

- New app `apps/webui`:
  - `package.json` with `next@14`, `react@18`, `react-dom@18`, `tailwindcss@4`, `@scorel/protocol` (workspace), `@scorel/client` (workspace).
  - `tsconfig.json` extending the repo TS base config.
  - `next.config.mjs` with `transpilePackages: ["@scorel/protocol", "@scorel/client"]` so monorepo TS sources work without prebuild.
  - Tailwind v4 wired through PostCSS (`postcss.config.mjs`) and global stylesheet.
- App Router shell:
  - `app/layout.tsx` — global HTML / body / Tailwind reset; renders sidebar slot + main slot.
  - `app/page.tsx` — root empty state ("Add a Device in Settings to start").
  - `app/devices/[deviceId]/page.tsx` — per-device empty state.
  - `app/devices/[deviceId]/projects/[projectSlug]/page.tsx` — per-project empty state.
  - `app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/page.tsx` — chatbox empty state.
  - `app/settings/page.tsx` — settings root empty.
  - `app/settings/devices/[deviceId]/page.tsx` — device edit empty.
- Sidebar / topbar component scaffolds:
  - `components/shell/sidebar.tsx` — hardcoded layout with `New Chat` action, empty Projects tree, bottom Settings link. No real data wiring.
  - `components/shell/topbar.tsx` — selected device label + connection placeholder.
  - All components are server-rendered or `"use client"` only when strictly needed.
- Build/dev scripts:
  - `pnpm --filter @scorel/webui dev` runs `next dev`.
  - `pnpm --filter @scorel/webui build` runs `next build`.
  - `pnpm --filter @scorel/webui typecheck` runs `tsc --noEmit -p tsconfig.json`.
  - `pnpm --filter @scorel/webui test` runs `vitest --run`. With zero tests v1, the script must still exit 0.
- Lint/format: lean on existing repo config; do not introduce ESLint per-app unless required by Next 14 to build.
- Repo-level `pnpm typecheck && pnpm test` continues to pass with the new app included.

## Not In Scope

- Device CRUD, BrowserStore, DaemonClient instantiation, real sidebar tree, chatbox, settings forms (M5.4–M5.9).
- UI library beyond Tailwind primitives (no Radix / Base UI / shadcn integration in this spec).
- Auth, theming, dark mode, i18n.
- Service worker / PWA / SSR optimization.
- Static export (`next export`); spec assumes `next dev` / `next build` against Node 22.

## Acceptance Criteria

- `pnpm install` succeeds with no warnings about peer deps Scorel can fix.
- `pnpm --filter @scorel/webui build` succeeds; output has the seven routes above.
- `pnpm --filter @scorel/webui dev` boots and serves all seven routes returning 200 with a recognizable empty-state string.
- `pnpm --filter @scorel/webui typecheck` succeeds.
- Top-level `pnpm typecheck && pnpm test` succeeds.
- `apps/webui/src` only imports from `@scorel/protocol` and `@scorel/client` (and Next/React/Tailwind). No imports from `@scorel/core` or Node-only paths. Enforced by a focused vitest spec or eslint rule (vitest is fine for v1).
- Routing matches §Scope exactly; URL params are accepted as plain strings (no decoding logic yet).
- Tailwind classes render (smoke: visit any route, body has Tailwind preflight applied).

## Tests

- Add `apps/webui/src/package-boundaries.test.ts` (Vitest) verifying the imports rule above by parsing TS files via `node:fs` and a simple regex over `from "..."` strings.
- Add `apps/webui/src/routes.test.ts` enumerating the seven route segments from `app/` directory listing and asserting they match the expected set.
- Run `pnpm --filter @scorel/webui typecheck && pnpm --filter @scorel/webui test`.
- Run `pnpm typecheck && pnpm test` at repo root.
- Manual: `pnpm --filter @scorel/webui dev`; visit each route; confirm empty state text.

## Affected Paths

- `apps/webui/package.json` (new)
- `apps/webui/tsconfig.json` (new)
- `apps/webui/next.config.mjs` (new)
- `apps/webui/postcss.config.mjs` (new)
- `apps/webui/tailwind.config.ts` (new — even though Tailwind 4 supports zero-config, pin content paths explicitly)
- `apps/webui/app/layout.tsx`
- `apps/webui/app/globals.css`
- `apps/webui/app/page.tsx`
- `apps/webui/app/devices/[deviceId]/page.tsx`
- `apps/webui/app/devices/[deviceId]/projects/[projectSlug]/page.tsx`
- `apps/webui/app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/page.tsx`
- `apps/webui/app/settings/page.tsx`
- `apps/webui/app/settings/devices/[deviceId]/page.tsx`
- `apps/webui/components/shell/sidebar.tsx`
- `apps/webui/components/shell/topbar.tsx`
- `apps/webui/src/package-boundaries.test.ts`
- `apps/webui/src/routes.test.ts`
- `pnpm-lock.yaml`
- `docs/architecture.md` (note WebUI app exists)
- `docs/ROADMAP.md` (M5 step entry for S0033)

## Risks And Boundaries

- **ESM in monorepo with Next**: Next 14 handles workspace TS via `transpilePackages`. If `@scorel/client` ships dual ESM/CJS later, this list must include both. Spec keeps `transpilePackages` and avoids introducing build steps for protocol/client.
- **Tailwind 4** is current at the time of writing; if API drift forces Tailwind 3, swap before merge — do not block M5 on Tailwind 4 specifics. *Implementation note (2026-05-31)*: Tailwind 4.3.0 stable + `@tailwindcss/postcss` 4.3.0 installed cleanly with Next 14.2.35; no fallback to Tailwind 3 was needed.
- **App Router strictness**: server components are default; any state hook needs `"use client"`. Skeleton stays mostly server-rendered.
- **Bundle size** is irrelevant v1; we run `next dev` locally and `next build` for verification, not production deploy.
- Do not pull in extra UI libs until S0034 actually needs them; this spec stays minimal so feature commits don't fight framework decisions.
