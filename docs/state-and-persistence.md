# State and persistence

Renderer state lives in a Vuex store; anything that must survive a restart is also written to a NeDB database owned by the main process.

## Store modules

`src/renderer/store/modules/`:

| Module | Holds | Persisted to |
|---|---|---|
| `settings.js` | Every user setting, with getters, mutations and actions generated per setting. | `settings` DB |
| `profiles.js` | Profiles and the channels each one subscribes to. | `profiles` DB |
| `subscription-cache.js` | The fetched feed per channel: videos, live, shorts, posts. | `subscription-cache` DB |
| `history.js` | Watch history and watch progress. | `history` DB |
| `playlists.js` | User playlists. | `playlists` DB |
| `search-history.js` | Past searches. | `search-history` DB |
| `invidious.js` | The current Invidious instance, its authorization, and the instance list. | No (the default instance is a setting) |
| `player.js` | Transient player state. | Not persisted |
| `utils.js` | Cross-cutting UI state: prompts, side nav, search filters, popular / trending / DeArrow caches, external player lists. | No |

To add a setting, follow the comment block at the top of `settings.js`. It explains when the auto-generated `state` path is enough and when a setting needs side effects or `customState`.

## Databases and handlers

`src/datastores/index.js` opens the NeDB files under the user-data directory, one file per DB.

`src/datastores/handlers/` has three layers:

| File | Runs in | Does |
|---|---|---|
| `base.js` | Main (Electron) or the page (web) | The actual NeDB queries. |
| `electron.js` | Electron renderer | Sends each call over IPC (`DB_SETTINGS`, `DB_HISTORY`, ...) as `{ action, data }`. |
| `web.js` | Web build | Calls `base.js` directly in the page. |

The store imports from `handlers/index.js`, which re-exports from the `DB_HANDLERS_ELECTRON_RENDERER_OR_WEB` alias, so store code is the same in both builds.

Action codes are `DBActions` in `src/constants.js`. The `GENERAL` group's values must not collide with the per-DB groups; the comment there explains why.

## Cross-window sync

FreeTube can open several windows, each with its own store. In main, each `DB_*` handler writes through `base.js`, then calls `syncOtherWindows(...)` to send a `SYNC_*` event (with a `SyncEvents` code) to every other FreeTube window. The preload interface forwards these events to the renderer, which applies them to its store without writing back to the DB.

A new DB action that changes data needs a matching sync event, or other windows go stale.

## Subscription feeds

The subscription list is in `profiles`; the fetched feeds are in `subscription-cache`. The feed tabs (`components/SubscriptionsVideos.vue`, `SubscriptionsLive.vue`, `SubscriptionsShorts.vue`, `SubscriptionPosts/`) each:

1. Read the cached feed for the active profile's channels.
2. Decide whether to fetch from remote (on first open per window, on the refresh button, or when the cache is missing or stale).
3. Fetch per channel via the Local API, Invidious, or RSS (`parseYouTubeRSSFeed` in `helpers/subscriptions.js`), then write results back to the cache.

`helpers/subscriptions.js` (`updateVideoListAfterProcessing`) applies the shared filtering and sorting.

A remote fetch over a feed that is already on screen runs in the background (`isRefreshing` in each tab, the spinning icon in `FtRefreshWidget`): the current list stays up, and the new results replace it in one step when every channel has answered. A channel whose fetch returns nothing usable (`videos` of `null`, e.g. a 403 on its RSS feed) keeps its cached entries in the new list, and error channels are swapped in at the end rather than cleared up front. `FtElementList` keys cards by item and occurrence, not by position, so new items slot in above existing cards and the rest move rather than remount. `FtListVideo` re-parses its data when a kept card receives a new object, which is how a stream that has ended loses its LIVE badge on the next refresh.
