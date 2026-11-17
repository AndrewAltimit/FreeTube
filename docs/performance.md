# Performance

How the app starts, what sits on the path to the first drawn subscription feed, and the scripts in [`_scripts/perf/`](../_scripts/perf/) that measure it. Most of FreeTube's waiting is on YouTube or Invidious, and video decoding happens in Chromium's native media pipeline, so the parts this fork's code controls are startup, IPC and rendering.

## Startup path

A launch with the subscription feed as the landing page goes through these steps, each waiting on the one before:

1. **Main process start.** `src/main/index.js` registers the `app://` scheme, calls `loadDatastores()` (in `src/datastores/handlers/base.js`) without awaiting it, and waits for Electron's `ready`.
2. **First window.** The `ready` handler reads app-ready settings (`_findAppReadyRelatedSettings`) and the base theme, then `createWindow` reads the window bounds. These are the only datastore reads before the window opens, which is why `loadDatastores` loads `settings` on its own before it starts the others.
3. **Renderer boot.** The window loads `app://bundle/index.html` and the single `renderer.js` bundle. The `app` scheme carries the `codeCache` privilege, so V8 reuses the compiled bundle between launches. Chromium checks the cached code against the script's content, so a changed bundle is never run from a stale cache.
4. **Store hydration.** `onMounted` in `App.vue` awaits `grabUserSettings`, then the bundled Invidious instance list, then `grabAllProfiles`. Only after the profiles does it dispatch `grabAllSubscriptions`, which fetches the whole subscription cache over IPC (`DB_SUBSCRIPTION_CACHE`, `FIND`).
5. **Feed.** `SubscriptionsVideos.vue` builds the feed from the cache (`loadVideosFromCacheForAllActiveProfileChannels`) and `SubscriptionsTabUi.vue` renders the first page of it.

The Windows jump list (`app.setUserTasks`) blocks the main thread while it is set, so it runs on a timer after startup rather than before `ready`.

## Where startup time goes

- **NeDB load.** `loadDatabaseAsync` parses every line of the file and then rewrites the file compacted, all on the main thread. The subscription cache is the largest datastore by far; community posts and videos make up most of it. A renderer request that arrives while it loads waits until it finishes.
- **The cache over IPC.** The whole cache crosses IPC as one structured clone. That costs far more than the NeDB `find` itself. Sending it as a JSON string instead saves only a few milliseconds once the renderer has revived the Dates (`{"$$date": …}` values, including `premiereDate` inside video entries).
- **Route transitions.** `App.vue` wraps the router view in an `out-in` fade, so switching views waits for the leave transition before the new view mounts. That delay is the animation, not rendering.

## Scripts

All of them drive the app over the Chrome DevTools Protocol and read timings the page records itself. Run them against a copy of a profile, never the real one, and turn off automatic subscription fetching in that copy so the numbers don't depend on YouTube.

| Script | Measures |
|---|---|
| [`cold-start.mjs`](../_scripts/perf/cold-start.mjs) | Process spawn to first paint, feed cards and largest paint, over repeated launches of the production bundles. |
| [`feed-profile.mjs`](../_scripts/perf/feed-profile.mjs) | Window reload to drawn feed, revisiting the feed, loading more of it, long tasks, renderer and main memory. |
| [`nedb-bench.mjs`](../_scripts/perf/nedb-bench.mjs) | Load, find, IPC-style copy, update and compaction of one datastore file, outside the app. |
| [`launch-packed.cjs`](../_scripts/perf/launch-packed.cjs) | Starts the production bundles against the profile in `FREETUBE_PERF_USER_DATA`. |

### Measuring a production build

```bash
pnpm run pack
FREETUBE_PERF_USER_DATA=<profile copy> node _scripts/perf/cold-start.mjs --runs 5
```

`feed-profile.mjs` attaches to a running app. Start the production bundles with `launch-packed.cjs` (`electron _scripts/perf/launch-packed.cjs --remote-debugging-port=9223 --inspect=9222`) and pass `--url app://bundle`. Or run it against `pnpm run debug` with the default URL. Development-build numbers include Vue devtools, dev-only warnings and an unminified bundle, so compare them only with each other.

### Comparing two builds

Timings drift between sessions by more than the differences worth measuring. Build each variant's `dist/main.js` (or `dist/renderer.js`) once, keep the copies, and alternate between them in rounds: copy one into `dist/`, run `cold-start.mjs`, copy the next. Compare the variants round by round, not one long run against another.

### Pitfalls

- A packaged build uses the real `%APPDATA%/FreeTube` profile unless it is started through `launch-packed.cjs`, which refuses to start without `FREETUBE_PERF_USER_DATA`.
- Don't attach a DevTools session to the window while it is still hidden and loading. That can leave the app unmounted. `cold-start.mjs` waits and reads the page's own timings afterwards for this reason. Playwright's `connectOverCDP` pauses new targets as it attaches, so attach it only once the app is up.
- A page-injected `PerformanceObserver` needs the `Page` domain enabled before `Page.addScriptToEvaluateOnNewDocument` takes effect, or long tasks silently read as zero.
- Read memory after `HeapProfiler.collectGarbage`. Before collection, the heap and node counts include garbage from earlier reloads and look like a leak.
