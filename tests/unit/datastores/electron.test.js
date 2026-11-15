// Tests for src/datastores/handlers/electron.js, the Electron renderer handlers
// that send every DB call to the main process through window.ftElectron.
//
// window.ftElectron is stubbed with one spy per preload DB method. Each preload
// method maps 1:1 onto an IPC channel (dbSettings -> 'dbSettings',
// see src/preload/interface.js), so "right method" means "right channel".
// The preload itself can't be imported here: Vite can't resolve
// 'electron/renderer' outside Electron (see the report for a config alias).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DBActions } from '../../../src/constants.js'
import * as handlers from '../../../src/datastores/handlers/electron.js'

const PRELOAD_DB_METHODS = ['dbSettings', 'dbHistory', 'dbProfiles', 'dbPlaylists', 'dbSearchHistory', 'dbSubscriptionCache']

let ftElectron

beforeEach(() => {
  ftElectron = Object.fromEntries(PRELOAD_DB_METHODS.map(name => [name, vi.fn().mockResolvedValue(`${name} result`)]))
  vi.stubGlobal('ftElectron', ftElectron)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const { GENERAL, HISTORY, PROFILES, PLAYLISTS, SUBSCRIPTION_CACHE } = DBActions

const channelData = { id: 'UC1', name: 'n', thumbnail: 't' }
const video = { videoId: 'v1', playlistItemId: 'i1' }

// [db, method, args, preload method, action, data]; data undefined means no data argument
const cases = [
  ['settings', 'find', [], 'dbSettings', GENERAL.FIND],
  ['settings', 'upsert', ['theme', 'dark'], 'dbSettings', GENERAL.UPSERT, { _id: 'theme', value: 'dark' }],

  ['history', 'find', [], 'dbHistory', GENERAL.FIND],
  ['history', 'upsert', [{ videoId: 'v1' }], 'dbHistory', GENERAL.UPSERT, { videoId: 'v1' }],
  ['history', 'overwrite', [[{ videoId: 'v1' }]], 'dbHistory', GENERAL.OVERWRITE, [{ videoId: 'v1' }]],
  ['history', 'updateWatchProgress', ['v1', 42], 'dbHistory', HISTORY.UPDATE_WATCH_PROGRESS, { videoId: 'v1', watchProgress: 42 }],
  [
    'history', 'updateLastViewedPlaylist', ['v1', 'PL1', 'user', 'i1'], 'dbHistory', HISTORY.UPDATE_PLAYLIST,
    { videoId: 'v1', lastViewedPlaylistId: 'PL1', lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: 'i1' },
  ],
  [
    'history', 'unsetLastViewedPlaylistForVideos', [['v1', 'v2'], 'PL1'], 'dbHistory', HISTORY.UNSET_PLAYLIST_FOR_VIDEOS,
    { videoIds: ['v1', 'v2'], lastViewedPlaylistId: 'PL1' },
  ],
  ['history', 'unsetLastViewedPlaylists', [['PL1']], 'dbHistory', HISTORY.UNSET_PLAYLISTS, ['PL1']],
  ['history', 'delete', ['v1'], 'dbHistory', GENERAL.DELETE, 'v1'],
  ['history', 'deleteAll', [], 'dbHistory', GENERAL.DELETE_ALL],

  ['profiles', 'create', [{ name: 'p' }], 'dbProfiles', GENERAL.CREATE, { name: 'p' }],
  ['profiles', 'find', [], 'dbProfiles', GENERAL.FIND],
  ['profiles', 'upsert', [{ _id: 'p1' }], 'dbProfiles', GENERAL.UPSERT, { _id: 'p1' }],
  [
    'profiles', 'addChannelToProfiles', [channelData, ['p1', 'p2']], 'dbProfiles', PROFILES.ADD_CHANNEL,
    { channel: channelData, profileIds: ['p1', 'p2'] },
  ],
  [
    'profiles', 'removeChannelFromProfiles', ['UC1', ['p1']], 'dbProfiles', PROFILES.REMOVE_CHANNEL,
    { channelId: 'UC1', profileIds: ['p1'] },
  ],
  ['profiles', 'delete', ['p1'], 'dbProfiles', GENERAL.DELETE, 'p1'],

  ['playlists', 'create', [[{ _id: 'pl1' }]], 'dbPlaylists', GENERAL.CREATE, [{ _id: 'pl1' }]],
  ['playlists', 'find', [], 'dbPlaylists', GENERAL.FIND],
  ['playlists', 'upsert', [{ _id: 'pl1' }], 'dbPlaylists', GENERAL.UPSERT, { _id: 'pl1' }],
  [
    'playlists', 'upsertVideoByPlaylistId', ['pl1', 5, video], 'dbPlaylists', PLAYLISTS.UPSERT_VIDEO,
    { _id: 'pl1', lastUpdatedAt: 5, videoData: video },
  ],
  [
    'playlists', 'upsertVideosByPlaylistId', ['pl1', 5, [video]], 'dbPlaylists', PLAYLISTS.UPSERT_VIDEOS,
    { _id: 'pl1', lastUpdatedAt: 5, videos: [video] },
  ],
  ['playlists', 'delete', ['pl1'], 'dbPlaylists', GENERAL.DELETE, 'pl1'],
  [
    'playlists', 'deleteVideoIdByPlaylistId', ['pl1', 5, 'v1', 'i1'], 'dbPlaylists', PLAYLISTS.DELETE_VIDEO_ID,
    { _id: 'pl1', lastUpdatedAt: 5, videoId: 'v1', playlistItemId: 'i1' },
  ],
  [
    'playlists', 'deleteVideoIdsByPlaylistId', ['pl1', 5, ['i1', 'i2']], 'dbPlaylists', PLAYLISTS.DELETE_VIDEO_IDS,
    { _id: 'pl1', lastUpdatedAt: 5, playlistItemIds: ['i1', 'i2'] },
  ],
  ['playlists', 'deleteAllVideosByPlaylistId', ['pl1'], 'dbPlaylists', PLAYLISTS.DELETE_ALL_VIDEOS, 'pl1'],
  ['playlists', 'deleteMultiple', [['pl1', 'pl2']], 'dbPlaylists', GENERAL.DELETE_MULTIPLE, ['pl1', 'pl2']],
  ['playlists', 'deleteAll', [], 'dbPlaylists', GENERAL.DELETE_ALL],

  ['searchHistory', 'find', [], 'dbSearchHistory', GENERAL.FIND],
  ['searchHistory', 'upsert', [{ _id: 'q' }], 'dbSearchHistory', GENERAL.UPSERT, { _id: 'q' }],
  ['searchHistory', 'overwrite', [[{ _id: 'q' }]], 'dbSearchHistory', GENERAL.OVERWRITE, [{ _id: 'q' }]],
  ['searchHistory', 'delete', ['q'], 'dbSearchHistory', GENERAL.DELETE, 'q'],
  ['searchHistory', 'deleteAll', [], 'dbSearchHistory', GENERAL.DELETE_ALL],

  ['subscriptionCache', 'find', [], 'dbSubscriptionCache', GENERAL.FIND],
  [
    'subscriptionCache', 'updateVideosByChannelId', ['UC1', [video], 9], 'dbSubscriptionCache',
    SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL, { channelId: 'UC1', entries: [video], timestamp: 9 },
  ],
  [
    'subscriptionCache', 'updateLiveStreamsByChannelId', ['UC1', [video], 9], 'dbSubscriptionCache',
    SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL, { channelId: 'UC1', entries: [video], timestamp: 9 },
  ],
  [
    'subscriptionCache', 'updateShortsByChannelId', ['UC1', [video], 9], 'dbSubscriptionCache',
    SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL, { channelId: 'UC1', entries: [video], timestamp: 9 },
  ],
  [
    'subscriptionCache', 'updateShortsWithChannelPageShortsByChannelId', ['UC1', [video]], 'dbSubscriptionCache',
    SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL, { channelId: 'UC1', entries: [video] },
  ],
  [
    'subscriptionCache', 'updateCommunityPostsByChannelId', ['UC1', [video], 9], 'dbSubscriptionCache',
    SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL, { channelId: 'UC1', entries: [video], timestamp: 9 },
  ],
  [
    'subscriptionCache', 'deleteMultipleChannels', [['UC1', 'UC2']], 'dbSubscriptionCache',
    GENERAL.DELETE_MULTIPLE, ['UC1', 'UC2'],
  ],
  ['subscriptionCache', 'deleteAll', [], 'dbSubscriptionCache', GENERAL.DELETE_ALL],
]

describe('electron DB handlers', () => {
  it.each(cases)('%s.%s forwards the right action to the right preload method', async (dbName, method, args, preloadMethod, action, data) => {
    const result = await handlers[dbName][method](...args)

    const expectedArgs = data === undefined ? [action] : [action, data]
    expect(ftElectron[preloadMethod]).toHaveBeenCalledExactlyOnceWith(...expectedArgs)
    expect(result).toBe(`${preloadMethod} result`)

    // nothing else crossed the bridge
    for (const name of PRELOAD_DB_METHODS.filter(name => name !== preloadMethod)) {
      expect(ftElectron[name]).not.toHaveBeenCalled()
    }
  })

  it('covers every handler method', () => {
    const tested = new Set(cases.map(([dbName, method]) => `${dbName}.${method}`))
    const all = Object.entries(handlers).flatMap(([dbName, cls]) =>
      Object.getOwnPropertyNames(cls)
        .filter(name => typeof cls[name] === 'function')
        .map(name => `${dbName}.${name}`)
    )

    expect(all.filter(name => !tested.has(name))).toEqual([])
  })

  it('propagates IPC rejections to the caller', async () => {
    ftElectron.dbSettings.mockRejectedValueOnce(new Error('main process failed'))

    await expect(handlers.settings.find()).rejects.toThrow('main process failed')
  })
})
