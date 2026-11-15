// Mock replacement for src/datastores/handlers/index.js.
//
// Usage (vi.mock is hoisted, so the factory imports this lazily):
//
//   vi.mock('../../../../src/datastores/handlers/index.js', async () =>
//     (await import('./helpers/db-handlers-mock.js')).createDBHandlersMock())
//
// Then import the handler groups from the real path in the test; Vitest hands
// back these mocks. Every method is a vi.fn() that resolves to undefined, so
// tests only configure the calls they care about (e.g. `find`).

import { vi } from 'vitest'

const HANDLER_METHODS = {
  DBSettingHandlers: ['find', 'upsert'],
  DBHistoryHandlers: [
    'find',
    'upsert',
    'overwrite',
    'updateWatchProgress',
    'updateLastViewedPlaylist',
    'unsetLastViewedPlaylistForVideos',
    'unsetLastViewedPlaylists',
    'delete',
    'deleteAll',
  ],
  DBProfileHandlers: ['create', 'find', 'upsert', 'addChannelToProfiles', 'removeChannelFromProfiles', 'delete'],
  DBPlaylistHandlers: [
    'create',
    'find',
    'upsert',
    'upsertVideoByPlaylistId',
    'upsertVideosByPlaylistId',
    'delete',
    'deleteVideoIdByPlaylistId',
    'deleteVideoIdsByPlaylistId',
    'deleteAllVideosByPlaylistId',
    'deleteMultiple',
    'deleteAll',
  ],
  DBSearchHistoryHandlers: ['find', 'upsert', 'overwrite', 'delete', 'deleteAll'],
  DBSubscriptionCacheHandlers: [
    'find',
    'updateVideosByChannelId',
    'updateLiveStreamsByChannelId',
    'updateShortsByChannelId',
    'updateShortsWithChannelPageShortsByChannelId',
    'updateCommunityPostsByChannelId',
    'deleteMultipleChannels',
    'deleteAll',
  ],
}

export function createDBHandlersMock() {
  const mock = {}
  for (const [group, methods] of Object.entries(HANDLER_METHODS)) {
    mock[group] = {}
    for (const method of methods) {
      mock[group][method] = vi.fn(async () => undefined)
    }
  }
  return mock
}
