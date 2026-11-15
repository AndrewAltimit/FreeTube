# CLAUDE.md

Guidance for Claude Code when working in this repository.

This file is a **map**, not the manual. The technical content lives in [`docs/`](docs/README.md). This file holds the mission, the rules, the commands and the cross-cutting traps every session needs, and points at the page for whatever you're touching.

Keep it that way when you edit it. It loads into every session and every subagent. Page lists belong on [`docs/README.md`](docs/README.md); rules that only apply to one subtree belong in that subtree's `CLAUDE.md`.

## Project mission

A single-maintainer fork of [FreeTubeApp/FreeTube](https://github.com/FreeTubeApp/FreeTube), the privacy-focused Electron YouTube client. Upstream moves slowly; this fork uses AI-assisted workflows to fix long-standing bugs (the subscription reload issues among them) directly.

- **All code changes are AI-authored under human direction.** No external contributions, feature requests or support ([`CONTRIBUTING.md`](CONTRIBUTING.md)).
- **Nothing goes upstream as a PR.** Upstream bans AI-authored PRs. The fork pulls *from* upstream, never pushes *to* it ([`docs/fork-workflow.md`](docs/fork-workflow.md)).
- **Stay mergeable with upstream.** Prefer small, targeted fixes over refactors and renames that would turn every upstream sync into a conflict. A fix that rewrites a file upstream is still actively changing is costly.
- **Privacy is the product.** No telemetry, no analytics, no new calls to Google-owned endpoints beyond what an extractor needs, no new third-party services without the maintainer's say-so.

## Repository map

| Path | What it is |
|---|---|
| [`src/main/`](src/main/) | Electron main process: windows, IPC handlers, the database owner, proxy, PO-token generation, external player. `index.js` is the hub. |
| [`src/preload/`](src/preload/) | `contextBridge` exposing `window.ftElectron` to the renderer. Every renderer-to-main call goes through `interface.js`. |
| [`src/renderer/`](src/renderer/) | Vue 3 app: `views/` (routes), `components/`, `store/modules/` (Vuex), `helpers/api/` (Local and Invidious extractors), `helpers/player/` (SABR, manifests). Rules in [`src/renderer/CLAUDE.md`](src/renderer/CLAUDE.md). |
| [`src/datastores/`](src/datastores/) | NeDB databases and the electron / web handler split. |
| [`src/constants.js`](src/constants.js) | IPC channel names, DB actions, sync events, shared enums. |
| [`static/locales/`](static/locales/) | UI strings. `en-US.yaml` is the only one edited by hand ([`docs/localization.md`](docs/localization.md)). |
| [`_scripts/`](_scripts/) | Webpack configs per target, the dev runner, electron-builder config, locale and instance tooling. |
| [`tests/`](tests/) | Vitest unit tests mirroring `src/`; config in `vitest.config.mjs` ([`docs/testing.md`](docs/testing.md)). |
| [`docs/`](docs/README.md) | This fork's technical reference. Index at [`docs/README.md`](docs/README.md); writing rules in [`docs/CLAUDE.md`](docs/CLAUDE.md). |
| [`.github/workflows-disabled/`](.github/workflows-disabled/README.md) | Upstream's CI, parked until it is rebuilt for the self-hosted runner. |

User-facing documentation (install, FAQ, usage) is upstream's at [docs.freetubeapp.io](https://docs.freetubeapp.io/); this repo's `docs/` covers how the code works and how the fork is run.

## Common commands

```bash
pnpm install                 # once per clone; also installs the lefthook pre-commit hook
pnpm run dev                 # Electron app with hot reload
pnpm run dev:web             # browser build (no Local API, no main process)
pnpm run debug               # dev with --remote-debug (attach from VS Code)
pnpm run lint                # ESLint + Stylelint; the gate before every commit
pnpm run lint-fix            # auto-fix what it can
pnpm run lint-all            # lint + locale JSON/YAML
pnpm test                    # Vitest unit tests (tests/); test:watch, test:coverage
pnpm run checkforbadtemplates  # Vue templates referencing missing components
pnpm run build               # pack all webpack targets + electron-builder for this platform
```

Upstream never had a test suite; this fork added one on Vitest ([`docs/testing.md`](docs/testing.md)). The gate before a commit lands on `main` is `pnpm run lint && pnpm test && pnpm run pack && pnpm run pack:web`: lint, unit tests, then compiling every target including the web build. Tests don't run in CI yet. Unit tests don't cover the Electron main process or real YouTube responses, so changes there still need the app run by hand; the [`verify` skill](.claude/skills/verify/SKILL.md) covers how.

## Conventions

- **Branches:** work on a feature branch off `main`, merge into `main`. There is no `development` branch in this fork's workflow ([`docs/fork-workflow.md`](docs/fork-workflow.md)).
- **Lint, tests and pack are the gate.** `pnpm run lint`, `pnpm test`, `pnpm run pack` and `pnpm run pack:web` must pass. A bug fix comes with a test that fails without it, where the code is reachable from a unit test. The lefthook pre-commit hook runs ESLint and Stylelint on staged files only; don't bypass it, and don't treat it as the whole gate.
- **Every user-visible string goes through i18n.** `vue-i18n/no-raw-text` and `no-dynamic-keys` are lint errors. Add keys to `static/locales/en-US.yaml` only.
- **Both APIs, both builds.** A data-path change has to work with the Local API (`youtubei.js`) and Invidious, and must not break the web build. Guard Electron-only code with `process.env.IS_ELECTRON` and Local-API-only code with `process.env.SUPPORTS_LOCAL_API` ([`docs/architecture.md`](docs/architecture.md#build-targets-and-flags)).
- **New settings follow the settings-module recipe.** The comment block at the top of [`src/renderer/store/modules/settings.js`](src/renderer/store/modules/settings.js) is authoritative; read it before adding one.
- **Keep dependencies minimal.** A new npm package needs a reason a few lines of code can't cover. Licences must be AGPL-compatible free software.
- **Commit messages** describe the change, not the session. End with the attribution line the harness provides.

## Cross-cutting facts that catch people out

- **The renderer never touches NeDB directly in Electron.** Renderer DB calls go `handlers/electron.js` → IPC (`DB_*` channels) → main → `handlers/base.js`. Main then broadcasts a `SYNC_*` event to every *other* window. Skip that broadcast and a second window shows stale data until restart. The web build swaps in `handlers/web.js` through a webpack alias (`DB_HANDLERS_ELECTRON_RENDERER_OR_WEB`). Details: [`docs/state-and-persistence.md`](docs/state-and-persistence.md).
- **`process.env.*` flags are compile-time constants**, replaced by webpack `DefinePlugin`, not runtime env vars. Setting one in your shell does nothing; dead branches are stripped from the bundle.
- **Adding an IPC call takes four edits:** the channel in `src/constants.js`, the handler in `src/main/index.js`, the wrapper in `src/preload/interface.js`, and the call site through `window.ftElectron`. The renderer has no `ipcRenderer`.
- **Subscription feeds are cached per profile in their own store** (`store/modules/subscription-cache.js`, persisted to its own DB), separate from the subscription list itself (`profiles`). Bugs in feed refresh usually sit in how `components/Subscriptions*.vue` decide between the cache and a remote load, not in the extractor.
- **YouTube breakage is often upstream of this repo.** Extraction lives in `youtubei.js` and `googlevideo`; a fix may be a dependency bump, not a code change. Check those projects' issues before patching around them.

## Writing rules for committed docs

Full rules in [`docs/CLAUDE.md`](docs/CLAUDE.md). The short form: present tense, describe what the code *is*; no dates, session logs, progress trackers or status tables in committed docs (operational state lives in git log and agent memory); a table cell is one line, longer explanations go in a section.
