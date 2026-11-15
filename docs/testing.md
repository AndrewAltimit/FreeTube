# Testing

Unit tests run on [Vitest](https://vitest.dev/) with a happy-dom environment. Upstream FreeTube has no test suite; this fork's suite starts from the areas its bug fixes touch. Tests are not run in CI yet.

```bash
pnpm test                  # run everything once
pnpm run test:watch        # re-run on change
pnpm run test:coverage     # V8 coverage report in coverage/
pnpm exec vitest run tests/unit/renderer/store   # one directory
```

## Layout

Tests live in `tests/`, mirroring `src/`:

| Path | Covers |
|---|---|
| `tests/setup.js` | Global setup loaded before every file: in-memory NeDB in place of `src/datastores/index.js`, real timers and cleared storage after each test. |
| `tests/stubs/` | Stand-ins for modules that only exist inside Electron (`electron/renderer`). |
| `tests/unit/renderer/helpers/` | Pure helpers in `src/renderer/helpers/` (subscriptions, strings, utils, ...). |
| `tests/unit/renderer/store/` | Vuex modules, run in a real `createStore` with the DB handlers mocked. |
| `tests/unit/renderer/api/` | Local API and Invidious normalizers against small handcrafted fixtures. |
| `tests/unit/renderer/player/` | Segment-index and manifest parsers against synthetic byte fixtures. |
| `tests/unit/datastores/` | `handlers/base.js` against in-memory NeDB; `handlers/electron.js` against a stubbed `window.ftElectron`. |
| `tests/unit/renderer/components/` | Component tests with `@vue/test-utils`, through a shared mount helper. |

## How the config mirrors the app

`vitest.config.mjs` reproduces what `_scripts/webpack.renderer.config.js` does, so renderer code imports unchanged:

- **Build flags are inlined as literals** by a small transform plugin: `IS_ELECTRON` is `false`, `IS_ELECTRON_MAIN` is `false`, `SUPPORTS_LOCAL_API` is `true`. Vite's `define` can't be used for these, because Vitest copies `process.env.*` defines into the real environment as strings, and the string `'false'` is truthy.
- **The same module aliases:** `DB_HANDLERS_ELECTRON_RENDERER_OR_WEB` (pointed at the web handlers), `youtubei.js` → `youtubei.js/web`, shaka-player's dist build, the trimmed Font Awesome core.
- **SFCs** compile through `@vitejs/plugin-vue`.
- **`electron/renderer`** resolves to `tests/stubs/electron-renderer.js`, so `src/preload/interface.js` can be imported and its IPC calls asserted.
- **Mocks reset between tests** (`mockReset` and `restoreMocks`), including return values set on `vi.fn`.
- **NeDB never touches disk.** `tests/setup.js` mocks `src/datastores/index.js` with in-memory stores, because the real module opens `*.db` files relative to the working directory at import time. `tests/unit/datastores/` mocks it again with fresh stores per test.

Because the flags are fixed per run, code behind `IS_ELECTRON` runs only through its non-Electron branch. Test Electron-only logic by stubbing `window.ftElectron` where the code reads it at call time, or by testing the pure function the branch calls.

## Conventions

- Import test APIs from `vitest` explicitly; there are no globals.
- Mock collaborators with `vi.mock` (the store, i18n, router, DB handlers) rather than loading the whole app. Mock paths need the `.js` extension (`src/renderer/store/index.js`). `helpers/utils.js` imports the router, which loads every view, so anything that reaches it should mock the router.
- Reusable pieces: `tests/unit/renderer/store/helpers/` (`createTestStore`, a full DB-handler mock), `tests/unit/renderer/components/helpers/mount.js` (i18n, Font Awesome and router stubs), and the fixture builders under `api/fixtures/` and `player/fixtures/`.
- Fixtures are small and handcrafted or heavily trimmed. Never commit captured video data or large API dumps.
- A test that pins a known bug uses `it.fails(...)` with a comment naming the bug. When the fix lands, the test starts passing, `it.fails` turns it red, and the fix switches it to `it`.
- No network. Mock `fetch` and youtubei.js.
- Tests are linted with the rest of the code (`pnpm run lint`).
