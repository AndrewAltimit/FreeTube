import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestStore } from './helpers/create-test-store.js'
import { DBHistoryHandlers, DBPlaylistHandlers } from '../../../../src/datastores/handlers/index.js'
import playlists from '../../../../src/renderer/store/modules/playlists.js'
import history from '../../../../src/renderer/store/modules/history.js'

vi.mock('../../../../src/datastores/handlers/index.js', async () =>
  (await import('./helpers/db-handlers-mock.js')).createDBHandlersMock())
vi.mock('../../../../src/renderer/i18n/index.js', async () =>
  (await import('./helpers/renderer-mocks.js')).createI18nMock())
vi.mock('../../../../src/renderer/router/index.js', async () =>
  (await import('./helpers/renderer-mocks.js')).createRouterMock())

const NOW = new Date('2026-06-01T12:00:00Z').getTime()

// grabAllPlaylists fires some dispatches without awaiting them
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

function video(videoId, extra = {}) {
  return { videoId, title: `Video ${videoId}`, author: 'A', authorId: 'UC1', lengthSeconds: 60, ...extra }
}

function playlist(_id, extra = {}) {
  return {
    _id,
    playlistName: `Playlist ${_id}`,
    protected: false,
    description: '',
    videos: [],
    createdAt: 1,
    lastUpdatedAt: 1,
    ...extra,
  }
}

/**
 * @param {object} [options]
 * @param {any[]} [options.list] initial playlists
 * @param {string} [options.quickBookmark] quickBookmarkTargetPlaylistId setting
 */
function buildStore({ list = [], quickBookmark = '' } = {}) {
  const updateQuickBookmarkTargetPlaylistId = vi.fn()
  const store = createTestStore({
    modules: { playlists, history },
    stubs: {
      settings: {
        state: { quickBookmarkTargetPlaylistId: quickBookmark },
        getters: { getQuickBookmarkTargetPlaylistId: (state) => state.quickBookmarkTargetPlaylistId },
        actions: { updateQuickBookmarkTargetPlaylistId },
      },
    },
  })
  if (list.length > 0) store.commit('setAllPlaylists', list)
  return { store, updateQuickBookmarkTargetPlaylistId }
}

const bookmarkTarget = (spy) => spy.mock.calls.map(([, id]) => id)
const playlistIds = (store) => store.getters.getAllPlaylists.map((p) => p._id)

let consoleError

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('playlists store module', () => {
  describe('getters', () => {
    it('getPlaylist finds by id', () => {
      const { store } = buildStore({ list: [playlist('a'), playlist('b')] })

      expect(store.getters.getPlaylist('b')._id).toBe('b')
      expect(store.getters.getPlaylist('zzz')).toBeUndefined()
    })

    it('getQuickBookmarkPlaylist resolves the quick bookmark setting', () => {
      expect(buildStore({ list: [playlist('a')], quickBookmark: 'a' }).store.getters.getQuickBookmarkPlaylist._id).toBe('a')
      expect(buildStore({ list: [playlist('a')], quickBookmark: '' }).store.getters.getQuickBookmarkPlaylist).toBeUndefined()
      expect(buildStore({ list: [playlist('a')], quickBookmark: 'gone' }).store.getters.getQuickBookmarkPlaylist).toBeUndefined()
    })
  })

  describe('addPlaylist', () => {
    it('normalises the playlist, persists it and adds it', async () => {
      const { store } = buildStore({ quickBookmark: 'x' })
      const input = {
        playlistName: '  My list  ',
        description: '  desc ',
        videos: [video('v1'), video('v2', { timeAdded: 5, playlistItemId: 'keep', type: 'short' })],
      }

      await store.dispatch('addPlaylist', input)

      const saved = DBPlaylistHandlers.create.mock.calls[0][0]
      expect(saved).toHaveLength(1)
      const [pl] = saved
      expect(pl._id).toMatch(/^ft-playlist--.+/)
      expect(pl.playlistName).toBe('My list')
      expect(pl.description).toBe('desc')
      expect(pl.createdAt).toBe(NOW)
      expect(pl.lastUpdatedAt).toBe(NOW)
      expect(pl.videos[0]).toMatchObject({ timeAdded: NOW, type: 'video' })
      expect(typeof pl.videos[0].playlistItemId).toBe('string')
      expect(pl.videos[1]).toMatchObject({ timeAdded: 5, playlistItemId: 'keep', type: 'short' })
      expect(store.getters.getAllPlaylists).toEqual([pl])
    })

    it('keeps a caller-provided id', async () => {
      const { store } = buildStore()

      await store.dispatch('addPlaylist', { _id: 'mine', playlistName: 'x', videos: [] })

      expect(playlistIds(store)).toEqual(['mine'])
    })

    it.each([
      ['no quick bookmark is set', ''],
      ['the quick bookmark points at a missing playlist', 'deleted'],
    ])('makes the new playlist the quick bookmark when %s', async (_, quickBookmark) => {
      const { store, updateQuickBookmarkTargetPlaylistId } = buildStore({ list: [playlist('a')], quickBookmark })

      await store.dispatch('addPlaylist', { _id: 'new', playlistName: 'x', videos: [] })

      expect(bookmarkTarget(updateQuickBookmarkTargetPlaylistId)).toEqual(['new'])
    })

    it('keeps an existing valid quick bookmark', async () => {
      const { store, updateQuickBookmarkTargetPlaylistId } = buildStore({ list: [playlist('a')], quickBookmark: 'a' })

      await store.dispatch('addPlaylist', { _id: 'new', playlistName: 'x', videos: [] })

      expect(updateQuickBookmarkTargetPlaylistId).not.toHaveBeenCalled()
    })

    it('adds nothing and leaves the bookmark alone when the DB write fails', async () => {
      const { store, updateQuickBookmarkTargetPlaylistId } = buildStore()
      DBPlaylistHandlers.create.mockRejectedValue(new Error('db'))

      await store.dispatch('addPlaylist', { _id: 'new', playlistName: 'x', videos: [] })

      expect(store.getters.getAllPlaylists).toEqual([])
      expect(updateQuickBookmarkTargetPlaylistId).not.toHaveBeenCalled()
      expect(consoleError).toHaveBeenCalled()
    })
  })

  describe('addPlaylists', () => {
    it('persists all playlists in one call and appends them', async () => {
      const { store } = buildStore({ list: [playlist('a')], quickBookmark: 'a' })
      const input = [{ _id: 'b', playlistName: ' B ', videos: [] }, { _id: 'c', playlistName: 'C', videos: [] }]

      await store.dispatch('addPlaylists', input)

      expect(DBPlaylistHandlers.create).toHaveBeenCalledTimes(1)
      expect(DBPlaylistHandlers.create.mock.calls[0][0].map((p) => p._id)).toEqual(['b', 'c'])
      expect(playlistIds(store)).toEqual(['a', 'b', 'c'])
      expect(store.getters.getPlaylist('b').playlistName).toBe('B')
    })

    it('picks the first empty playlist as quick bookmark when none is set', async () => {
      const { store, updateQuickBookmarkTargetPlaylistId } = buildStore()

      await store.dispatch('addPlaylists', [
        { _id: 'full', playlistName: 'F', videos: [video('v')], lastPlayedAt: 999 },
        { _id: 'empty', playlistName: 'E', videos: [] },
      ])

      expect(bookmarkTarget(updateQuickBookmarkTargetPlaylistId)).toEqual(['empty'])
    })

    it('otherwise picks the most recently played playlist', async () => {
      const { store, updateQuickBookmarkTargetPlaylistId } = buildStore()

      await store.dispatch('addPlaylists', [
        { _id: 'never', playlistName: 'N', videos: [video('a')] },
        { _id: 'recent', playlistName: 'R', videos: [video('b')], lastPlayedAt: 300 },
        { _id: 'older', playlistName: 'O', videos: [video('c')], lastPlayedAt: 100 },
      ])

      expect(bookmarkTarget(updateQuickBookmarkTargetPlaylistId)).toEqual(['recent'])
    })

    it('falls back to the first playlist when none was ever played', async () => {
      const { store, updateQuickBookmarkTargetPlaylistId } = buildStore()

      await store.dispatch('addPlaylists', [
        { _id: 'first', playlistName: '1', videos: [video('a')] },
        { _id: 'second', playlistName: '2', videos: [video('b')] },
      ])

      expect(bookmarkTarget(updateQuickBookmarkTargetPlaylistId)).toEqual(['first'])
    })
  })

  describe('updatePlaylist / updatePlaylistLastPlayedAt', () => {
    it('trims, stamps lastUpdatedAt, persists and merges into the existing playlist', async () => {
      const { store } = buildStore({ list: [playlist('a', { lastPlayedAt: 7 }), playlist('b')] })

      await store.dispatch('updatePlaylist', { _id: 'a', playlistName: ' Renamed ', description: ' d ' })

      expect(DBPlaylistHandlers.upsert).toHaveBeenCalledWith({
        _id: 'a',
        playlistName: 'Renamed',
        description: 'd',
        lastUpdatedAt: NOW,
      })
      const updated = store.getters.getPlaylist('a')
      expect(updated).toMatchObject({ playlistName: 'Renamed', description: 'd', lastUpdatedAt: NOW })
      // fields absent from the update are kept (merge, not replace)
      expect(updated.lastPlayedAt).toBe(7)
      expect(updated.createdAt).toBe(1)
      expect(playlistIds(store)).toEqual(['a', 'b'])
    })

    it('appends a playlist that is not in the list yet', async () => {
      const { store } = buildStore({ list: [playlist('a')] })

      await store.dispatch('updatePlaylist', playlist('new'))

      expect(playlistIds(store)).toEqual(['a', 'new'])
    })

    it('updatePlaylistLastPlayedAt sets lastPlayedAt but not lastUpdatedAt', async () => {
      const { store } = buildStore({ list: [playlist('a')] })

      await store.dispatch('updatePlaylistLastPlayedAt', playlist('a'))

      const saved = DBPlaylistHandlers.upsert.mock.calls[0][0]
      expect(saved.lastPlayedAt).toBe(NOW)
      expect(saved.lastUpdatedAt).toBe(1)
      expect(store.getters.getPlaylist('a')).toMatchObject({ lastPlayedAt: NOW, lastUpdatedAt: 1 })
    })

    it('updatePlaylist leaves state alone when the DB write fails', async () => {
      const { store } = buildStore({ list: [playlist('a')] })
      DBPlaylistHandlers.upsert.mockRejectedValue(new Error('db'))

      await store.dispatch('updatePlaylist', { _id: 'a', playlistName: 'Changed' })

      expect(store.getters.getPlaylist('a').playlistName).toBe('Playlist a')
    })
  })

  describe('adding videos', () => {
    it('addVideo fills required fields, persists and appends the video', async () => {
      const { store } = buildStore({ list: [playlist('a', { videos: [video('old', { playlistItemId: 'i0' })] })] })
      const videoData = video('new')

      await store.dispatch('addVideo', { _id: 'a', videoData })

      expect(DBPlaylistHandlers.upsertVideoByPlaylistId).toHaveBeenCalledWith('a', NOW, videoData)
      expect(videoData).toMatchObject({ timeAdded: NOW, type: 'video' })
      const pl = store.getters.getPlaylist('a')
      expect(pl.videos.map((v) => v.videoId)).toEqual(['old', 'new'])
      expect(pl.lastUpdatedAt).toBe(NOW)
    })

    it('addVideo to an unknown playlist does not throw or create it', async () => {
      const { store } = buildStore({ list: [playlist('a')] })

      await store.dispatch('addVideo', { _id: 'missing', videoData: video('v') })

      expect(playlistIds(store)).toEqual(['a'])
      expect(consoleError).not.toHaveBeenCalled()
    })

    it('addVideos copies inputs, strips display-only fields and always assigns new item ids', async () => {
      const { store } = buildStore({ list: [playlist('a')] })
      const input = [
        video('v1', { description: 'x', viewCount: 5, index: 0, liveNow: false, authorUrl: 'u', videoThumbnails: [], playlistItemId: 'dup' }),
        video('v2', { timeAdded: 42, type: 'short', playlistItemId: 'dup' }),
      ]
      const snapshot = structuredClone(input)

      await store.dispatch('addVideos', { _id: 'a', videos: input })

      // caller's objects are untouched
      expect(input).toEqual(snapshot)

      const [id, lastUpdatedAt, saved] = DBPlaylistHandlers.upsertVideosByPlaylistId.mock.calls[0]
      expect(id).toBe('a')
      expect(lastUpdatedAt).toBe(NOW)
      for (const attr of ['description', 'viewCount', 'index', 'liveNow', 'authorUrl', 'videoThumbnails']) {
        expect(saved[0]).not.toHaveProperty(attr)
      }
      expect(saved[0]).toMatchObject({ timeAdded: NOW, type: 'video' })
      expect(saved[1]).toMatchObject({ timeAdded: 42, type: 'short' })
      expect(saved[0].playlistItemId).not.toBe('dup')
      expect(saved[0].playlistItemId).not.toBe(saved[1].playlistItemId)

      const pl = store.getters.getPlaylist('a')
      expect(pl.videos).toEqual(saved)
      expect(pl.lastUpdatedAt).toBe(NOW)
    })

    it('addVideos leaves the playlist untouched when the DB write fails', async () => {
      const { store } = buildStore({ list: [playlist('a')] })
      DBPlaylistHandlers.upsertVideosByPlaylistId.mockRejectedValue(new Error('db'))

      await store.dispatch('addVideos', { _id: 'a', videos: [video('v')] })

      expect(store.getters.getPlaylist('a').videos).toEqual([])
    })
  })

  describe('removing videos', () => {
    const items = () => [
      video('v1', { playlistItemId: 'i1' }),
      video('v1', { playlistItemId: 'i2' }), // same video added twice
      video('v2', { playlistItemId: 'i3' }),
    ]

    it('removeVideo by playlistItemId removes only that entry and clears last-viewed history for it', async () => {
      const { store } = buildStore({ list: [playlist('a', { videos: items() })] })

      await store.dispatch('removeVideo', { _id: 'a', videoId: 'v1', playlistItemId: 'i2' })

      expect(DBHistoryHandlers.unsetLastViewedPlaylistForVideos).toHaveBeenCalledWith(['v1'], 'a')
      expect(DBPlaylistHandlers.deleteVideoIdByPlaylistId).toHaveBeenCalledWith('a', NOW, 'v1', 'i2')
      const pl = store.getters.getPlaylist('a')
      expect(pl.videos.map((v) => v.playlistItemId)).toEqual(['i1', 'i3'])
      expect(pl.lastUpdatedAt).toBe(NOW)
    })

    it('removeVideo without playlistItemId removes every entry of that video', async () => {
      const { store } = buildStore({ list: [playlist('a', { videos: items() })] })

      await store.dispatch('removeVideo', { _id: 'a', videoId: 'v1' })

      expect(store.getters.getPlaylist('a').videos.map((v) => v.playlistItemId)).toEqual(['i3'])
    })

    it('removeVideo with neither id leaves the playlist and its timestamp alone', () => {
      const { store } = buildStore({ list: [playlist('a', { videos: items() })] })

      store.commit('removeVideo', { _id: 'a', lastUpdatedAt: NOW })

      const pl = store.getters.getPlaylist('a')
      expect(pl.videos).toHaveLength(3)
      expect(pl.lastUpdatedAt).toBe(1)
    })

    it('removeVideos removes the listed playlist items', async () => {
      const { store } = buildStore({ list: [playlist('a', { videos: items() })] })

      await store.dispatch('removeVideos', { _id: 'a', videoIds: ['v1', 'v2'], playlistItemIds: ['i1', 'i3'] })

      expect(DBHistoryHandlers.unsetLastViewedPlaylistForVideos).toHaveBeenCalledWith(['v1', 'v2'], 'a')
      expect(DBPlaylistHandlers.deleteVideoIdsByPlaylistId).toHaveBeenCalledWith('a', NOW, ['i1', 'i3'])
      expect(store.getters.getPlaylist('a').videos.map((v) => v.playlistItemId)).toEqual(['i2'])
    })

    it('removeAllVideos empties the playlist and clears last-viewed history for it', async () => {
      const { store } = buildStore({ list: [playlist('a', { videos: items() }), playlist('b', { videos: items() })] })

      await store.dispatch('removeAllVideos', 'a')

      expect(DBHistoryHandlers.unsetLastViewedPlaylists).toHaveBeenCalledWith(['a'])
      expect(DBPlaylistHandlers.deleteAllVideosByPlaylistId).toHaveBeenCalledWith('a')
      expect(store.getters.getPlaylist('a').videos).toEqual([])
      expect(store.getters.getPlaylist('b').videos).toHaveLength(3)
    })
  })

  describe('removing playlists', () => {
    it('removePlaylist clears history references, deletes and removes it', async () => {
      const { store } = buildStore({ list: [playlist('a'), playlist('b')] })
      store.commit('setHistoryCacheSorted', [{ videoId: 'v', lastViewedPlaylistId: 'a' }])

      await store.dispatch('removePlaylist', 'a')

      expect(DBHistoryHandlers.unsetLastViewedPlaylists).toHaveBeenCalledWith(['a'])
      expect(DBPlaylistHandlers.delete).toHaveBeenCalledWith('a')
      expect(playlistIds(store)).toEqual(['b'])
      expect(store.getters.getHistoryCacheSorted[0].lastViewedPlaylistId).toBeUndefined()
    })

    it('removePlaylist keeps protected playlists (the DB handler skips them too)', async () => {
      const { store } = buildStore({ list: [playlist('p', { protected: true })] })

      await store.dispatch('removePlaylist', 'p')

      expect(playlistIds(store)).toEqual(['p'])
    })

    it('removePlaylist keeps the playlist when the DB delete fails', async () => {
      const { store } = buildStore({ list: [playlist('a')] })
      DBPlaylistHandlers.delete.mockRejectedValue(new Error('db'))

      await store.dispatch('removePlaylist', 'a')

      expect(playlistIds(store)).toEqual(['a'])
    })

    it('removePlaylists persists the deletion of several playlists', async () => {
      const { store } = buildStore({ list: [playlist('a'), playlist('b'), playlist('c')] })

      await store.dispatch('removePlaylists', ['a', 'c'])

      expect(DBHistoryHandlers.unsetLastViewedPlaylists).toHaveBeenCalledWith(['a', 'c'])
      expect(DBPlaylistHandlers.deleteMultiple).toHaveBeenCalledWith(['a', 'c'])
    })

    // BUG: playlists.js `removePlaylists` commits 'removePlaylists', but the
    // module has no such mutation (only `removePlaylist`). Vuex ignores the
    // unknown commit, so the playlists are deleted from the DB but stay in the
    // store until the next reload. The action is currently unused in the app.
    it.fails('removePlaylists also removes the playlists from the store', async () => {
      const { store } = buildStore({ list: [playlist('a'), playlist('b'), playlist('c')] })

      await store.dispatch('removePlaylists', ['a', 'c'])

      expect(playlistIds(store)).toEqual(['b'])
    })

    it('removeAllPlaylists clears history references for every playlist and empties the list', async () => {
      const { store } = buildStore({ list: [playlist('a'), playlist('b')] })

      await store.dispatch('removeAllPlaylists')

      expect(DBHistoryHandlers.unsetLastViewedPlaylists).toHaveBeenCalledWith(['a', 'b'])
      expect(DBPlaylistHandlers.deleteAll).toHaveBeenCalledTimes(1)
      expect(store.getters.getAllPlaylists).toEqual([])
    })
  })

  describe('grabAllPlaylists', () => {
    it('creates the default Favorites and Watch Later playlists when the DB is empty', async () => {
      DBPlaylistHandlers.find.mockResolvedValue([])
      const { store, updateQuickBookmarkTargetPlaylistId } = buildStore()

      await store.dispatch('grabAllPlaylists')
      await flushPromises()

      expect(DBPlaylistHandlers.create).toHaveBeenCalledTimes(2)
      expect(playlistIds(store)).toEqual(['favorites', 'watchLater'])
      expect(store.getters.getPlaylist('favorites')).toMatchObject({ playlistName: 'Favorites', createdAt: NOW, videos: [] })
      expect(store.getters.getPlaylistsReady).toBe(true)
      expect(bookmarkTarget(updateQuickBookmarkTargetPlaylistId)[0]).toBe('favorites')
    })

    it('does not mutate the module default playlists when creating them', async () => {
      DBPlaylistHandlers.find.mockResolvedValue([])
      const { store } = buildStore()

      await store.dispatch('grabAllPlaylists')
      await flushPromises()

      expect(store.state.playlists.defaultPlaylists[0]).not.toHaveProperty('createdAt')
    })

    it('loads stored playlists, dropping null documents', async () => {
      const stored = [playlist('favorites', { playlistName: 'Favorites' }), null, playlist('x')]
      DBPlaylistHandlers.find.mockResolvedValue(stored)
      const { store } = buildStore({ quickBookmark: 'x' })

      await store.dispatch('grabAllPlaylists')

      expect(playlistIds(store)).toEqual(['favorites', 'x'])
      expect(DBPlaylistHandlers.upsert).not.toHaveBeenCalled()
      expect(DBPlaylistHandlers.create).not.toHaveBeenCalled()
      expect(store.getters.getPlaylistsReady).toBe(true)
    })

    it('repairs missing fields and saves only the playlists that needed it', async () => {
      DBPlaylistHandlers.find.mockResolvedValue([
        { _id: 'broken', videos: [{ videoId: 'v', description: 'd', viewCount: 1 }] },
        playlist('fine', { videos: [video('v', { timeAdded: 1, playlistItemId: 'i', type: 'video' })] }),
      ])
      const { store } = buildStore({ quickBookmark: 'fine' })

      await store.dispatch('grabAllPlaylists')

      expect(DBPlaylistHandlers.upsert).toHaveBeenCalledTimes(1)
      const repaired = DBPlaylistHandlers.upsert.mock.calls[0][0]
      expect(repaired._id).toBe('broken')
      expect(repaired.playlistName).toMatch(/^Playlist /)
      expect(repaired.createdAt).toBe(NOW)
      expect(repaired.lastUpdatedAt).toBe(NOW)
      expect(repaired.videos[0]).toEqual({ videoId: 'v', timeAdded: NOW, playlistItemId: expect.any(String), type: 'video' })
    })

    it('gives a playlist with no id a generated one', async () => {
      DBPlaylistHandlers.find.mockResolvedValue([{ ...playlist(undefined), _id: undefined }])
      const { store } = buildStore()

      await store.dispatch('grabAllPlaylists')

      expect(playlistIds(store)[0]).toMatch(/^ft-playlist--/)
    })

    it('migrates a legacy "Favorites" playlist to the fixed favorites id', async () => {
      DBPlaylistHandlers.find.mockResolvedValue([
        playlist('legacy-fav', { playlistName: 'Favorites', protected: true }),
        playlist('other'),
      ])
      const { store } = buildStore({ quickBookmark: 'other' })

      await store.dispatch('grabAllPlaylists')
      await flushPromises()

      expect(DBPlaylistHandlers.delete).toHaveBeenCalledWith('legacy-fav')
      expect(DBPlaylistHandlers.create).toHaveBeenCalledWith(expect.objectContaining({ _id: 'favorites', protected: false }))
      expect(playlistIds(store)).toEqual(['favorites', 'other'])
    })

    it('unprotects default playlists that already have the fixed id', async () => {
      DBPlaylistHandlers.find.mockResolvedValue([
        playlist('watchLater', { playlistName: 'Watch Later', protected: true }),
      ])
      const { store } = buildStore({ quickBookmark: 'watchLater' })

      await store.dispatch('grabAllPlaylists')

      expect(DBPlaylistHandlers.upsert).toHaveBeenCalledWith(expect.objectContaining({ _id: 'watchLater', protected: false }))
      expect(DBPlaylistHandlers.delete).not.toHaveBeenCalled()
    })

    it('picks a quick bookmark when the configured one is not among the loaded playlists', async () => {
      DBPlaylistHandlers.find.mockResolvedValue([
        playlist('a', { videos: [video('v')], lastPlayedAt: 5 }),
        playlist('b', { videos: [video('v')], lastPlayedAt: 10 }),
      ])
      const { store, updateQuickBookmarkTargetPlaylistId } = buildStore({ quickBookmark: 'deleted' })

      await store.dispatch('grabAllPlaylists')

      expect(bookmarkTarget(updateQuickBookmarkTargetPlaylistId)).toEqual(['b'])
    })

    it('does not become ready when the DB read fails', async () => {
      DBPlaylistHandlers.find.mockRejectedValue(new Error('db'))
      const { store } = buildStore()

      await store.dispatch('grabAllPlaylists')

      expect(store.getters.getPlaylistsReady).toBe(false)
      expect(DBPlaylistHandlers.create).not.toHaveBeenCalled()
    })
  })
})
