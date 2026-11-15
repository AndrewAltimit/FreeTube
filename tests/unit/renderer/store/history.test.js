import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestStore } from './helpers/create-test-store.js'
import { DBHistoryHandlers } from '../../../../src/datastores/handlers/index.js'
import history from '../../../../src/renderer/store/modules/history.js'

vi.mock('../../../../src/datastores/handlers/index.js', async () =>
  (await import('./helpers/db-handlers-mock.js')).createDBHandlersMock())

function record(videoId, timeWatched, extra = {}) {
  return { videoId, title: `Video ${videoId}`, timeWatched, watchProgress: 0, ...extra }
}

function buildStore(records = []) {
  const store = createTestStore({ modules: { history } })
  if (records.length > 0) {
    // mirror grabHistory: both views share the same objects
    store.commit('setHistoryCacheSorted', records)
    store.commit('setHistoryCacheById', Object.fromEntries(records.map((r) => [r.videoId, r])))
  }
  return store
}

const sortedIds = (store) => store.getters.getHistoryCacheSorted.map((r) => r.videoId)

let consoleError

beforeEach(() => {
  vi.resetAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('history store module', () => {
  describe('grabHistory', () => {
    it('keeps the DB order and indexes the same objects by videoId', async () => {
      const records = [record('b', 200), record('a', 100)]
      DBHistoryHandlers.find.mockResolvedValue(records)
      const store = buildStore()

      await store.dispatch('grabHistory')

      expect(sortedIds(store)).toEqual(['b', 'a'])
      expect(Object.keys(store.getters.getHistoryCacheById).sort()).toEqual(['a', 'b'])
      expect(store.getters.getHistoryCacheById.a).toBe(store.getters.getHistoryCacheSorted[1])
    })

    it('leaves the cache untouched when the DB read fails', async () => {
      const store = buildStore([record('a', 1)])
      DBHistoryHandlers.find.mockRejectedValue(new Error('db'))

      await store.dispatch('grabHistory')

      expect(sortedIds(store)).toEqual(['a'])
      expect(consoleError).toHaveBeenCalled()
    })
  })

  describe('updateHistory', () => {
    it('persists the record and puts a new video at the top', async () => {
      const store = buildStore([record('a', 100)])
      const rec = record('b', 200)

      await store.dispatch('updateHistory', rec)

      expect(DBHistoryHandlers.upsert).toHaveBeenCalledWith(rec)
      expect(sortedIds(store)).toEqual(['b', 'a'])
      expect(store.getters.getHistoryCacheById.b).toEqual(rec)
    })

    it('moves a re-watched video to the top without duplicating it', async () => {
      const store = buildStore([record('a', 300), record('b', 200), record('c', 100)])
      const rewatch = record('c', 400, { watchProgress: 12 })

      await store.dispatch('updateHistory', rewatch)

      expect(sortedIds(store)).toEqual(['c', 'a', 'b'])
      expect(store.getters.getHistoryCacheSorted[0]).toEqual(rewatch)
      expect(store.getters.getHistoryCacheById.c.watchProgress).toBe(12)
    })

    it('keeps the by-id map and the sorted list pointing at the same record', async () => {
      const store = buildStore()

      await store.dispatch('updateHistory', record('a', 1))
      store.commit('updateRecordWatchProgressInHistoryCache', { videoId: 'a', watchProgress: 42 })

      expect(store.getters.getHistoryCacheSorted[0].watchProgress).toBe(42)
    })

    it('does not touch the cache when the DB write fails', async () => {
      const store = buildStore()
      DBHistoryHandlers.upsert.mockRejectedValue(new Error('db'))

      await store.dispatch('updateHistory', record('a', 1))

      expect(store.getters.getHistoryCacheSorted).toEqual([])
      expect(store.getters.getHistoryCacheById).toEqual({})
    })
  })

  describe('overwriteHistory', () => {
    it('sorts newest first before saving and replaces both caches', async () => {
      const store = buildStore([record('old', 1)])
      const items = new Map([
        ['a', record('a', 100)],
        ['c', record('c', 300)],
        ['b', record('b', 200)],
      ])

      await store.dispatch('overwriteHistory', items)

      const saved = DBHistoryHandlers.overwrite.mock.calls[0][0]
      expect(saved.map((r) => r.videoId)).toEqual(['c', 'b', 'a'])
      expect(sortedIds(store)).toEqual(['c', 'b', 'a'])
      expect(Object.keys(store.getters.getHistoryCacheById).sort()).toEqual(['a', 'b', 'c'])
      expect(store.getters.getHistoryCacheById.old).toBeUndefined()
    })

    it('keeps the old cache when the DB write fails', async () => {
      const store = buildStore([record('old', 1)])
      DBHistoryHandlers.overwrite.mockRejectedValue(new Error('db'))

      await store.dispatch('overwriteHistory', new Map([['a', record('a', 1)]]))

      expect(sortedIds(store)).toEqual(['old'])
    })
  })

  describe('removal', () => {
    it('removeFromHistory deletes one video from the DB and both caches', async () => {
      const store = buildStore([record('a', 3), record('b', 2), record('c', 1)])

      await store.dispatch('removeFromHistory', 'b')

      expect(DBHistoryHandlers.delete).toHaveBeenCalledWith('b')
      expect(sortedIds(store)).toEqual(['a', 'c'])
      expect(store.getters.getHistoryCacheById.b).toBeUndefined()
    })

    it('removeFromHistory with an unknown id changes nothing', async () => {
      const store = buildStore([record('a', 1)])

      await store.dispatch('removeFromHistory', 'zzz')

      expect(sortedIds(store)).toEqual(['a'])
    })

    it('removeAllHistory clears the DB and both caches', async () => {
      const store = buildStore([record('a', 1), record('b', 2)])

      await store.dispatch('removeAllHistory')

      expect(DBHistoryHandlers.deleteAll).toHaveBeenCalledTimes(1)
      expect(store.getters.getHistoryCacheSorted).toEqual([])
      expect(store.getters.getHistoryCacheById).toEqual({})
    })

    it('removeAllHistory keeps the cache when the DB delete fails', async () => {
      const store = buildStore([record('a', 1)])
      DBHistoryHandlers.deleteAll.mockRejectedValue(new Error('db'))

      await store.dispatch('removeAllHistory')

      expect(sortedIds(store)).toEqual(['a'])
    })
  })

  describe('updateWatchProgress', () => {
    it('persists and updates the record in place without reordering', async () => {
      const store = buildStore([record('a', 2), record('b', 1)])

      await store.dispatch('updateWatchProgress', { videoId: 'b', watchProgress: 99 })

      expect(DBHistoryHandlers.updateWatchProgress).toHaveBeenCalledWith('b', 99)
      expect(sortedIds(store)).toEqual(['a', 'b'])
      expect(store.getters.getHistoryCacheSorted[1].watchProgress).toBe(99)
    })

    it('does not resurrect a video that was removed from history', async () => {
      const store = buildStore()

      await store.dispatch('updateWatchProgress', { videoId: 'gone', watchProgress: 5 })

      expect(DBHistoryHandlers.updateWatchProgress).toHaveBeenCalledWith('gone', 5)
      expect(store.getters.getHistoryCacheById).toEqual({})
      expect(store.getters.getHistoryCacheSorted).toEqual([])
    })
  })

  describe('last viewed playlist', () => {
    const playlistFields = (r) => ({
      lastViewedPlaylistId: r.lastViewedPlaylistId,
      lastViewedPlaylistType: r.lastViewedPlaylistType,
      lastViewedPlaylistItemId: r.lastViewedPlaylistItemId,
    })

    it('updateLastViewedPlaylist persists positionally and sets all three fields', async () => {
      const store = buildStore([record('a', 1)])

      await store.dispatch('updateLastViewedPlaylist', {
        videoId: 'a',
        lastViewedPlaylistId: 'pl1',
        lastViewedPlaylistType: 'user',
        lastViewedPlaylistItemId: 'item1',
      })

      expect(DBHistoryHandlers.updateLastViewedPlaylist).toHaveBeenCalledWith('a', 'pl1', 'user', 'item1')
      expect(playlistFields(store.getters.getHistoryCacheById.a))
        .toEqual({ lastViewedPlaylistId: 'pl1', lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: 'item1' })
    })

    it('updateLastViewedPlaylist ignores videos not in history', async () => {
      const store = buildStore()

      await store.dispatch('updateLastViewedPlaylist', { videoId: 'x', lastViewedPlaylistId: 'pl1' })

      expect(store.getters.getHistoryCacheById).toEqual({})
    })

    it('unsetLastViewedPlaylistForVideos only clears records pointing at that playlist', async () => {
      const pl = { lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: 'i' }
      const store = buildStore([
        record('a', 3, { lastViewedPlaylistId: 'pl1', ...pl }),
        record('b', 2, { lastViewedPlaylistId: 'pl2', ...pl }),
        record('c', 1, { lastViewedPlaylistId: 'pl1', ...pl }),
      ])

      await store.dispatch('unsetLastViewedPlaylistForVideos', { videoIds: ['a', 'b', 'missing'], lastViewedPlaylistId: 'pl1' })

      expect(DBHistoryHandlers.unsetLastViewedPlaylistForVideos).toHaveBeenCalledWith(['a', 'b', 'missing'], 'pl1')
      const byId = store.getters.getHistoryCacheById
      expect('lastViewedPlaylistId' in byId.a).toBe(false)
      expect('lastViewedPlaylistType' in byId.a).toBe(false)
      expect('lastViewedPlaylistItemId' in byId.a).toBe(false)
      expect(byId.b.lastViewedPlaylistId).toBe('pl2')
      // not in videoIds, so untouched even though it matches the playlist
      expect(byId.c.lastViewedPlaylistId).toBe('pl1')
    })

    it('unsetLastViewedPlaylists clears every record pointing at any of the playlists', async () => {
      const store = buildStore([
        record('a', 3, { lastViewedPlaylistId: 'pl1', lastViewedPlaylistType: 'user' }),
        record('b', 2, { lastViewedPlaylistId: 'pl2', lastViewedPlaylistType: 'user' }),
        record('c', 1, { lastViewedPlaylistId: 'pl3', lastViewedPlaylistType: 'user' }),
        record('d', 0),
      ])

      await store.dispatch('unsetLastViewedPlaylists', ['pl1', 'pl3'])

      expect(DBHistoryHandlers.unsetLastViewedPlaylists).toHaveBeenCalledWith(['pl1', 'pl3'])
      const byId = store.getters.getHistoryCacheById
      expect(byId.a.lastViewedPlaylistId).toBeUndefined()
      expect(byId.a.lastViewedPlaylistType).toBeUndefined()
      expect(byId.b.lastViewedPlaylistId).toBe('pl2')
      expect(byId.c.lastViewedPlaylistId).toBeUndefined()
      expect(byId.d).toEqual(record('d', 0))
    })

    it('does not change the cache when the DB write fails', async () => {
      const store = buildStore([record('a', 1, { lastViewedPlaylistId: 'pl1' })])
      DBHistoryHandlers.unsetLastViewedPlaylists.mockRejectedValue(new Error('db'))

      await store.dispatch('unsetLastViewedPlaylists', ['pl1'])

      expect(store.getters.getHistoryCacheById.a.lastViewedPlaylistId).toBe('pl1')
    })
  })
})
