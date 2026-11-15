---
name: verify
description: How to verify a change in this repo - lint, the Vitest suite, compiling every target, and what to check by hand in the running app.
---

# Verifying changes in FreeTube

Verification is the gates below (lint, unit tests, compiling every webpack target), then running the app through the path the change touches. Unit tests cover helpers, store modules, datastores, API normalizers and parsers ([`docs/testing.md`](../../../docs/testing.md)); they don't cover the main process or live YouTube responses.

## 1. Gates (always)

```bash
pnpm run lint                   # ESLint + Stylelint; must pass
pnpm test                       # Vitest; must pass (a bug fix adds a test that fails without it)
pnpm run pack                   # compiles main, preload, renderer, botGuard; catches broken imports
pnpm run pack:web               # compiles the web build; catches Electron-only code leaking into it
pnpm run lint-all               # also lints locale YAML/JSON; run when static/locales/ changed
pnpm run checkforbadtemplates   # when a template references a new or renamed component
```

## 2. Run the app

```bash
pnpm run dev        # Electron, hot reload for the renderer; main-process edits restart the app
pnpm run dev:web    # browser build on a local dev server; Invidious only, no main process
```

Use `pnpm run debug` to attach a debugger (VS Code launch config `dev-runner (Electron)`). In dev, DevTools open automatically with each window.

## 3. What to exercise

Pick what the change touches:

- **Data paths (views, `helpers/api/`):** test with the Local API **and** Invidious (Settings > General > Preferred API Backend), with fallback on and off.
- **Anything `IS_ELECTRON`-guarded or in `src/main/`:** check that `pnpm run dev:web` still builds and the feature degrades cleanly there.
- **Store / DB changes:** open a second window (Ctrl+N) and confirm it picks up the change without a restart (cross-window sync). Restart the app and confirm the change persisted.
- **Subscriptions:** test with more than one profile, with the cache empty (fresh profile) and populated, and with the refresh button.
- **Settings:** toggle the setting, restart, confirm it stuck. If it has side effects, confirm they apply on startup as well as on change.
- **UI:** check light and dark themes, and a non-English locale to catch hard-coded strings or layout overflow.

## 4. Packaging (only when build config changed)

```bash
pnpm run build      # pack + electron-builder for this platform
```

Report what you ran and what you checked by hand. If something couldn't be verified (for example, a macOS-only path on Windows), say so.
