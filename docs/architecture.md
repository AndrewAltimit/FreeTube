# Architecture

FreeTube is an Electron app with a Vue 3 renderer. The same renderer source also builds as a plain web app, with fewer features.

## Processes

| Process | Entry | Role |
|---|---|---|
| Main | `src/main/index.js` | Creates windows, owns the NeDB databases, handles every IPC channel, runs the proxy, PO-token generation (`poTokenGenerator.js`), the image cache and external players. |
| Preload | `src/preload/main.js` | Exposes `src/preload/interface.js` to the renderer as `window.ftElectron` through `contextBridge`. |
| Renderer | `src/renderer/main.js` | The Vue app: router, Vuex store, i18n, the player. Runs with context isolation, so it has no Node or Electron APIs of its own. |

`src/botGuardScript.js` is bundled separately (`pack:botGuardScript`) and run by the main process to obtain PO tokens.

## IPC

Channel names live in `IpcChannels` in `src/constants.js`. A call from the renderer to main touches four places:

1. The channel constant in `src/constants.js`.
2. `ipcMain.handle(...)` (request/response) or `ipcMain.on(...)` in `src/main/index.js`.
3. A wrapper in `src/preload/interface.js` that calls `ipcRenderer.invoke` / `send`, or registers an `ipcRenderer.on` listener for main-to-renderer events.
4. The call site, through `window.ftElectron`, guarded by `process.env.IS_ELECTRON`.

Main-to-renderer events (`SYNC_*`, `OPEN_URL`, `CHANGE_VIEW`, `NATIVE_THEME_UPDATE`) are registered as listeners in the preload interface and wired up in `src/renderer/App.vue` / the store.

## Build targets and flags

Each target has its own webpack config in `_scripts/`:

| Target | Config | Notes |
|---|---|---|
| Main | `webpack.main.config.js` | Node target, Electron main. |
| Preload | `webpack.preload.config.js` | Bundles the `ftElectron` bridge. |
| Renderer | `webpack.renderer.config.js` | The Electron renderer. |
| Web | `webpack.web.config.js` | The renderer as a browser app (`pnpm run dev:web`, `pack:web`). |
| BotGuard | `webpack.botGuardScript.config.js` | The PO-token script. |

The configs set compile-time flags through `DefinePlugin`. Code reads them as `process.env.X`, but they are literals in the bundle, and unreachable branches are removed:

| Flag | Main | Renderer | Web |
|---|---|---|---|
| `IS_ELECTRON_MAIN` | `true` | `false` | `false` |
| `IS_ELECTRON` | n/a | `true` | `false` |
| `SUPPORTS_LOCAL_API` | n/a | `true` | `false` |

The web build can't use the Local API (browser CORS rules), so it always uses Invidious. Any code path that calls `youtubei.js` must be behind `SUPPORTS_LOCAL_API`, with an Invidious fallback.

Webpack aliases also swap modules per target. The important one is `DB_HANDLERS_ELECTRON_RENDERER_OR_WEB`, which resolves to `src/datastores/handlers/electron.js` in the renderer and `web.js` in the web build ([`state-and-persistence.md`](state-and-persistence.md)).

`pnpm run pack` runs every target, then `_scripts/injectAllowedPaths.mjs`. `pnpm run build` follows it with electron-builder (`_scripts/build.mjs`, `_scripts/ebuilder.config.mjs`).

## Extractor APIs

| API | Code | Backed by |
|---|---|---|
| Local | `src/renderer/helpers/api/local.js` | `youtubei.js` (InnerTube), with `googlevideo` for SABR streaming. |
| Invidious | `src/renderer/helpers/api/invidious.js` | A user-chosen Invidious instance's REST API. Instance list in `static/invidious-instances.json`. |

The user picks a backend and can turn on a fallback to the other. Views call into these helpers and normalize the results into shared shapes, so a field missing from one API's output is a common source of bugs that only show up on that API.

Playback runs on `shaka-player`. SABR manifests and segment-index parsing live in `src/renderer/helpers/player/`; SponsorBlock in `helpers/sponsorblock.js`.

Mid-playback, the SABR server can ask for a new player response (a `RELOAD_PLAYER_RESPONSE` part, a rejected PO token, or a retry loop the scheme plugin detects). `SabrSchemePlugin.js` first refreshes the stream in place. It calls the `sabrRefresh` callback the player gets from `refreshSabrData` in `views/Watch/Watch.js`, which fetches a new player response, carrying the server's reload token, through `getLocalVideoInfo`. It then swaps the streaming URL, PO token and ustreamer config into the running stream and resends the segment request. Concurrent requests share one refresh, and playback continues from shaka's buffer. Only when the refresh isn't possible does the player emit `player-reload-requested` and the Watch view reload in full: no data, the manifest's formats changed, or the same request needs a second refresh. Refreshes and full reloads share one rate limit (`registerSabrReload` in `helpers/player/utils.js`).
