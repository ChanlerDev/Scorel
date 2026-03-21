# V0-M5: Release

> Code signing + notarization + installer + optional auto-updater

## Goal

Ship a distributable macOS application that users can install and run without Gatekeeper warnings.

## Scope

- **electron-builder**: DMG + ZIP distribution
- **Code signing**: Apple Developer ID certificate
- **Notarization**: Apple notary service integration
- **Auto-updater** (optional): electron-updater with GitHub Releases
- **First-run experience**: provider setup wizard
- **Polish**: error boundaries, loading states, keyboard shortcuts

## Key Implementation Notes

### Build Pipeline

```
pnpm build
  → TypeScript compilation (main + preload + renderer)
  → Webpack/Vite bundle renderer
  → electron-builder package
  → codesign + notarize (CI only)
  → DMG + ZIP artifacts
```

### First-Run Flow

1. App launches → detect no providers configured
2. Show setup wizard: select provider type (OpenAI / Anthropic / OpenAI-compatible)
3. Enter base URL + API key + select model
4. Test connection
5. Create first session with workspace folder picker

### Polish Checklist

- [ ] Error boundaries in React (crash → show error, not blank screen)
- [ ] Loading/spinner states for streaming, tool execution, compact
- [ ] Keyboard shortcuts: Cmd+N (new session), Cmd+Enter (send), Escape (abort)
- [ ] Dark mode support (follow system preference)
- [ ] Window state persistence (position, size)
- [ ] Graceful shutdown (wait for in-flight operations)

## Acceptance Criteria

- [ ] DMG installs without Gatekeeper warning on clean macOS
- [ ] App launches, provider setup wizard works end-to-end
- [ ] Full loop: configure → chat → tool round → search → compact → export → restart → resume
- [ ] No console errors in production build

## Files to Create/Modify

| File | Action |
|------|--------|
| `electron-builder.yml` | Create: build configuration |
| `scripts/notarize.js` | Create: notarization script |
| `src/renderer/components/SetupWizard.tsx` | Create: first-run provider setup |
| Various renderer components | Modify: polish, error boundaries, loading states |

## Definition of Done

A non-developer can download the DMG, install, configure a provider, and complete a full coding session with tool use.
