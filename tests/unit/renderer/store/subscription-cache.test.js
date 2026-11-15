import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestStore } from './helpers/create-test-store.js'
import { DBSubscriptionCacheHandlers } from '../../../../src/datastores/handlers/index.js'
import subscriptionCache from '../../../../src/renderer/store/modules/subscription-cache.js'
import profiles from '../../../../src/renderer/store/modules/profiles.js'
import { MAIN_PROFILE_ID } from '../../../../src/constants.js'

vi.mock('../../../../src/datastores/handlers/index.js', async () =>
  (await import('./helpers/db-handlers-mock.js')).createDBHandlersMock())
vi.mock('../../../../src/renderer/i18n/index.js', async () =>
  (await import('./helpers/renderer-mocks.js')).createI18nMock())
vi.mock('../../../../src/renderer/router/index.js', async () =>
  (await import('./helpers/renderer-mocks.js')).createRouterMock())

// grabAllSubscriptions dispatches the cleanup without awaiting it
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

function channel(id) {
  return { id, name: `Channel ${id}`, thumbnail: `https://yt3.googleusercontent.com/${id}=s176` }
}

function buildStore(subscribedIds = ['UC1', 'UC2'], extraProfiles = []) {
  return createTestStore({
    modules: { subscriptionCache, profiles },
    state: {
      profiles: {
        profileList: [
          {
            _id: MAIN_PROFILE_ID,
            name: 'All Channels',
            bgColor: '#000000',
            textColor: '#FFFFFF',
            subscriptions: subscribedIds.map(channel),
          },
          ...extraProfiles,
        ],
      },
    },
  })
}

function video(videoId, extra = {}) {
  return { videoId, title: `Title ${videoId}`, author: 'Author', viewCount: 100, ...extra }
}

/**
 * Every feed type follows the same write path; describe them once.
 * `payloadKey` is the action payload field, `entryKey` the cache entry field.
 */
const FEED_TYPES = [
  {
    name: 'videos',
    action: 'updateSubscriptionVideosCacheByChannel',
    mutation: 'updateVideoCacheByChannel',
    handler: 'updateVideosByChannelId',
    getter: 'getVideoCache',
    payloadKey: 'videos',
    entryKey: 'videos',
  },
  {
    name: 'shorts',
    action: 'updateSubscriptionShortsCacheByChannel',
    mutation: 'updateShortsCacheByChannel',
    handler: 'updateShortsByChannelId',
    getter: 'getShortsCache',
    payloadKey: 'videos',
    entryKey: 'videos',
  },
  {
    name: 'live',
    action: 'updateSubscriptionLiveCacheByChannel',
    mutation: 'updateLiveCacheByChannel',
    handler: 'updateLiveStreamsByChannelId',
    getter: 'getLiveCache',
    payloadKey: 'videos',
    entryKey: 'videos',
  },
  {
    name: 'posts',
    action: 'updateSubscriptionPostsCacheByChannel',
    mutation: 'updatePostsCacheByChannel',
    handler: 'updateCommunityPostsByChannelId',
    getter: 'getPostsCache',
    payloadKey: 'posts',
    entryKey: 'posts',
  },
]

const ALL_GETTERS = FEED_TYPES.map((type) => type.getter)

let consoleError

beforeEach(() => {
  // restoreMocks only restores spies; reset the handler mocks so a
  // mockRejectedValue in one test cannot leak into the next.
  vi.resetAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('subscription-cache store module', () => {
  describe('initial state', () => {
    it('starts with empty caches and not ready', () => {
      const store = buildStore()

      for (const getter of ALL_GETTERS) {
        expect(store.getters[getter]).toEqual({})
      }
      expect(store.getters.getSubscriptionCacheReady).toBe(false)
    })

    it('does not share state between store instances', () => {
      const first = buildStore()
      first.commit('updateVideoCacheByChannel', { channelId: 'UC1', entries: [video('a')] })

      const second = buildStore()
      expect(second.getters.getVideoCache).toEqual({})
    })
  })

  describe('grabAllSubscriptions', () => {
    it('loads every feed type for subscribed channels with its own timestamp', async () => {
      const t1 = new Date('2026-01-01T00:00:00Z')
      const t2 = new Date('2026-01-02T00:00:00Z')
      const t3 = new Date('2026-01-03T00:00:00Z')
      const t4 = new Date('2026-01-04T00:00:00Z')

      DBSubscriptionCacheHandlers.find.mockResolvedValue([
        {
          _id: 'UC1',
          videos: [video('v1')],
          videosTimestamp: t1,
          liveStreams: [video('l1')],
          liveStreamsTimestamp: t2,
          shorts: [video('s1')],
          shortsTimestamp: t3,
          communityPosts: [{ postId: 'p1' }],
          communityPostsTimestamp: t4,
        },
      ])

      const store = buildStore()
      await store.dispatch('grabAllSubscriptions')

      expect(store.getters.getVideoCache).toEqual({ UC1: { videos: [video('v1')], timestamp: t1 } })
      expect(store.getters.getLiveCache).toEqual({ UC1: { videos: [video('l1')], timestamp: t2 } })
      expect(store.getters.getShortsCache).toEqual({ UC1: { videos: [video('s1')], timestamp: t3 } })
      // posts are stored under `posts`, not `videos`
      expect(store.getters.getPostsCache).toEqual({ UC1: { posts: [{ postId: 'p1' }], timestamp: t4 } })
      expect(store.getters.getSubscriptionCacheReady).toBe(true)
      expect(DBSubscriptionCacheHandlers.deleteMultipleChannels).not.toHaveBeenCalled()
    })

    it('only creates cache entries for the feed types a channel actually has', async () => {
      const ts = new Date('2026-02-01T00:00:00Z')
      DBSubscriptionCacheHandlers.find.mockResolvedValue([
        { _id: 'UC1', videos: [video('v1')], videosTimestamp: ts },
        { _id: 'UC2', shorts: [], shortsTimestamp: ts },
      ])

      const store = buildStore()
      await store.dispatch('grabAllSubscriptions')

      expect(Object.keys(store.getters.getVideoCache)).toEqual(['UC1'])
      expect(Object.keys(store.getters.getShortsCache)).toEqual(['UC2'])
      // an empty array is valid data (channel has no shorts), not "missing"
      expect(store.getters.getShortsCache.UC2).toEqual({ videos: [], timestamp: ts })
      expect(store.getters.getLiveCache).toEqual({})
      expect(store.getters.getPostsCache).toEqual({})
    })

    it('ignores non-array feed fields such as null left by an earlier write', async () => {
      const ts = new Date()
      DBSubscriptionCacheHandlers.find.mockResolvedValue([
        { _id: 'UC1', videos: null, videosTimestamp: ts, liveStreams: [video('l1')], liveStreamsTimestamp: ts },
      ])

      const store = buildStore()
      await store.dispatch('grabAllSubscriptions')

      expect(store.getters.getVideoCache).toEqual({})
      expect(store.getters.getLiveCache.UC1.videos).toEqual([video('l1')])
    })

    it('deletes and skips cache entries for channels that are no longer subscribed', async () => {
      const ts = new Date()
      DBSubscriptionCacheHandlers.find.mockResolvedValue([
        { _id: 'UC1', videos: [video('v1')], videosTimestamp: ts },
        { _id: 'UCgone', videos: [video('old')], videosTimestamp: ts },
      ])

      const store = buildStore(['UC1'])
      await store.dispatch('grabAllSubscriptions')
      await flushPromises()

      expect(DBSubscriptionCacheHandlers.deleteMultipleChannels).toHaveBeenCalledTimes(1)
      expect(DBSubscriptionCacheHandlers.deleteMultipleChannels).toHaveBeenCalledWith(['UCgone'])
      expect(store.getters.getVideoCache.UC1.videos).toEqual([video('v1')])
      expect(store.getters.getVideoCache.UCgone ?? null).toBeNull()
    })

    it('deletes subscribed channels whose cache document has no feed data at all', async () => {
      DBSubscriptionCacheHandlers.find.mockResolvedValue([
        { _id: 'UC1' },
        { _id: 'UC2', videos: 'not-an-array' },
      ])

      const store = buildStore(['UC1', 'UC2'])
      await store.dispatch('grabAllSubscriptions')

      expect(DBSubscriptionCacheHandlers.deleteMultipleChannels).toHaveBeenCalledWith(['UC1', 'UC2'])
      expect(store.getters.getSubscriptionCacheReady).toBe(true)
    })

    it('uses the "All Channels" profile for the subscribed set, not the active profile', async () => {
      const ts = new Date()
      DBSubscriptionCacheHandlers.find.mockResolvedValue([
        { _id: 'UC1', videos: [video('v1')], videosTimestamp: ts },
        { _id: 'UC2', videos: [video('v2')], videosTimestamp: ts },
      ])

      const otherProfile = { _id: 'p2', name: 'Other', bgColor: '#fff', textColor: '#000', subscriptions: [channel('UC1')] }
      const store = buildStore(['UC1', 'UC2'], [otherProfile])
      store.commit('setActiveProfile', 'p2')

      await store.dispatch('grabAllSubscriptions')

      expect(Object.keys(store.getters.getVideoCache).sort()).toEqual(['UC1', 'UC2'])
      expect(DBSubscriptionCacheHandlers.deleteMultipleChannels).not.toHaveBeenCalled()
    })

    // Documents a hazard rather than asserting a fix: App.vue runs this after
    // grabAllProfiles even when loading profiles failed, in which case the main
    // profile is the empty placeholder and every cached channel is deleted.
    it('treats every cached channel as unsubscribed when the main profile has no subscriptions', async () => {
      DBSubscriptionCacheHandlers.find.mockResolvedValue([
        { _id: 'UC1', videos: [video('v1')], videosTimestamp: new Date() },
      ])

      const store = buildStore([])
      await store.dispatch('grabAllSubscriptions')
      await flushPromises()

      expect(DBSubscriptionCacheHandlers.deleteMultipleChannels).toHaveBeenCalledWith(['UC1'])
      expect(store.getters.getVideoCache.UC1 ?? null).toBeNull()
    })

    it('replaces anything already in memory with the DB contents', async () => {
      const store = buildStore()
      store.commit('updateVideoCacheByChannel', { channelId: 'UC2', entries: [video('stale')] })

      DBSubscriptionCacheHandlers.find.mockResolvedValue([
        { _id: 'UC1', videos: [video('v1')], videosTimestamp: new Date() },
      ])
      await store.dispatch('grabAllSubscriptions')

      expect(Object.keys(store.getters.getVideoCache)).toEqual(['UC1'])
    })

    it('leaves state untouched and not ready when the DB read fails', async () => {
      const store = buildStore()
      store.commit('updateVideoCacheByChannel', { channelId: 'UC1', entries: [video('v1')] })
      DBSubscriptionCacheHandlers.find.mockRejectedValue(new Error('db down'))

      await store.dispatch('grabAllSubscriptions')

      expect(store.getters.getVideoCache.UC1.videos).toEqual([video('v1')])
      expect(store.getters.getSubscriptionCacheReady).toBe(false)
      expect(consoleError).toHaveBeenCalled()
    })
  })

  describe.each(FEED_TYPES)('$name feed writes', (type) => {
    const otherGetters = ALL_GETTERS.filter((getter) => getter !== type.getter)

    it('persists to the DB with (channelId, entries, timestamp) and updates the cache', async () => {
      const store = buildStore()
      const entries = [video('a'), video('b')]
      const timestamp = new Date('2026-03-01T12:00:00Z')

      await store.dispatch(type.action, { channelId: 'UC1', [type.payloadKey]: entries, timestamp })

      expect(DBSubscriptionCacheHandlers[type.handler]).toHaveBeenCalledTimes(1)
      expect(DBSubscriptionCacheHandlers[type.handler]).toHaveBeenCalledWith('UC1', entries, timestamp)
      expect(store.getters[type.getter]).toEqual({ UC1: { [type.entryKey]: entries, timestamp } })
    })

    it('defaults the timestamp to now and uses the same Date for DB and cache', async () => {
      const store = buildStore()
      const before = Date.now()

      await store.dispatch(type.action, { channelId: 'UC1', [type.payloadKey]: [video('a')] })

      const after = Date.now()
      const [, , dbTimestamp] = DBSubscriptionCacheHandlers[type.handler].mock.calls[0]
      const cacheTimestamp = store.getters[type.getter].UC1.timestamp

      expect(dbTimestamp).toBeInstanceOf(Date)
      expect(dbTimestamp.getTime()).toBeGreaterThanOrEqual(before)
      expect(dbTimestamp.getTime()).toBeLessThanOrEqual(after)
      expect(cacheTimestamp).toBe(dbTimestamp)
    })

    it('replaces the entries and timestamp of an already cached channel', async () => {
      const store = buildStore()
      const oldTs = new Date('2026-01-01T00:00:00Z')
      const newTs = new Date('2026-01-02T00:00:00Z')

      await store.dispatch(type.action, { channelId: 'UC1', [type.payloadKey]: [video('old')], timestamp: oldTs })
      await store.dispatch(type.action, { channelId: 'UC1', [type.payloadKey]: [video('new')], timestamp: newTs })

      expect(store.getters[type.getter].UC1).toEqual({ [type.entryKey]: [video('new')], timestamp: newTs })
    })

    it('only touches the given channel and this feed type', async () => {
      const store = buildStore()
      const ts = new Date('2026-01-01T00:00:00Z')
      await store.dispatch(type.action, { channelId: 'UC2', [type.payloadKey]: [video('keep')], timestamp: ts })

      await store.dispatch(type.action, { channelId: 'UC1', [type.payloadKey]: [video('a')] })

      expect(store.getters[type.getter].UC2).toEqual({ [type.entryKey]: [video('keep')], timestamp: ts })
      for (const getter of otherGetters) {
        expect(store.getters[getter]).toEqual({})
      }
    })

    it('does not update the cache when the DB write fails', async () => {
      const store = buildStore()
      DBSubscriptionCacheHandlers[type.handler].mockRejectedValue(new Error('write failed'))

      await store.dispatch(type.action, { channelId: 'UC1', [type.payloadKey]: [video('a')] })

      expect(store.getters[type.getter]).toEqual({})
      expect(consoleError).toHaveBeenCalled()
    })

    // The DB handler `$set`s entries even when they are null, so after a
    // restart the channel has no data for this feed; the in-memory cache
    // instead keeps the previous list and only refreshes the timestamp.
    it('mutation keeps the previous entries but refreshes the timestamp when entries are null', () => {
      const store = buildStore()
      const oldTs = new Date('2026-01-01T00:00:00Z')
      const newTs = new Date('2026-01-02T00:00:00Z')
      store.commit(type.mutation, { channelId: 'UC1', entries: [video('a')], timestamp: oldTs })

      store.commit(type.mutation, { channelId: 'UC1', entries: null, timestamp: newTs })

      expect(store.getters[type.getter].UC1).toEqual({ [type.entryKey]: [video('a')], timestamp: newTs })
    })

    it('mutation creates an entry with null data for an uncached channel when entries are null', () => {
      const store = buildStore()
      const ts = new Date()

      store.commit(type.mutation, { channelId: 'UC1', entries: null, timestamp: ts })

      expect(store.getters[type.getter].UC1).toEqual({ [type.entryKey]: null, timestamp: ts })
    })

    it('mutation can repopulate a channel after it was cleared', () => {
      const store = buildStore()
      store.commit(type.mutation, { channelId: 'UC1', entries: [video('a')] })
      store.commit('clearCachesForManyChannels', ['UC1'])

      const ts = new Date()
      store.commit(type.mutation, { channelId: 'UC1', entries: [video('b')], timestamp: ts })

      expect(store.getters[type.getter].UC1).toEqual({ [type.entryKey]: [video('b')], timestamp: ts })
    })
  })

  describe('updateSubscriptionShortsCacheWithChannelPageShorts', () => {
    function storeWithShorts(shorts, timestamp = new Date('2026-01-01T00:00:00Z')) {
      const store = buildStore()
      store.commit('updateShortsCacheByChannel', { channelId: 'UC1', entries: shorts, timestamp })
      return store
    }

    it('persists via the DB handler with (channelId, videos)', async () => {
      const store = storeWithShorts([video('s1')])
      const pageShorts = [video('s1', { title: 'New' })]

      await store.dispatch('updateSubscriptionShortsCacheWithChannelPageShorts', { channelId: 'UC1', videos: pageShorts })

      expect(DBSubscriptionCacheHandlers.updateShortsWithChannelPageShortsByChannelId)
        .toHaveBeenCalledWith('UC1', pageShorts)
    })

    it('updates title and author of matching cached shorts only', async () => {
      const ts = new Date('2026-01-01T00:00:00Z')
      const store = storeWithShorts([video('s1'), video('s2')], ts)

      await store.dispatch('updateSubscriptionShortsCacheWithChannelPageShorts', {
        channelId: 'UC1',
        videos: [video('s1', { title: 'Renamed', author: 'New Author' }), video('s3', { title: 'Not cached' })],
      })

      const cached = store.getters.getShortsCache.UC1
      expect(cached.videos).toEqual([
        video('s1', { title: 'Renamed', author: 'New Author' }),
        video('s2'),
      ])
      // channel page data does not count as a feed refresh
      expect(cached.timestamp).toBe(ts)
    })

    it('only raises the view count, never lowers it (channel page counts are rounded)', async () => {
      const store = storeWithShorts([
        video('low', { viewCount: 12345 }),
        video('high', { viewCount: 12345 }),
      ])

      await store.dispatch('updateSubscriptionShortsCacheWithChannelPageShorts', {
        channelId: 'UC1',
        videos: [video('low', { viewCount: 12000 }), video('high', { viewCount: 15000 })],
      })

      const [low, high] = store.getters.getShortsCache.UC1.videos
      expect(low.viewCount).toBe(12345)
      expect(high.viewCount).toBe(15000)
    })

    it('does nothing for a channel that has no cached shorts', async () => {
      const store = buildStore()

      await store.dispatch('updateSubscriptionShortsCacheWithChannelPageShorts', {
        channelId: 'UC1',
        videos: [video('s1')],
      })

      expect(store.getters.getShortsCache).toEqual({})
      expect(consoleError).not.toHaveBeenCalled()
    })

    it('does nothing for a channel whose cache entry was cleared', () => {
      const store = storeWithShorts([video('s1')])
      store.commit('clearCachesForManyChannels', ['UC1'])

      expect(() => store.commit('updateShortsCacheWithChannelPageShorts', {
        channelId: 'UC1',
        entries: [video('s1')],
      })).not.toThrow()
    })

    // BUG: subscription-cache.js `updateShortsCacheWithChannelPageShorts` reads
    // `cachedObject.videos.length` without checking for null. An entry with
    // `videos: null` exists after `updateShortsCacheByChannel` is committed with
    // null entries for an uncached channel. The DB handler guards this case with
    // Array.isArray; the mutation (also used directly by cross-window sync)
    // throws a TypeError instead.
    it.fails('does not throw when the cached shorts entry has no videos', () => {
      const store = buildStore()
      store.commit('updateShortsCacheByChannel', { channelId: 'UC1', entries: null })

      expect(() => store.commit('updateShortsCacheWithChannelPageShorts', {
        channelId: 'UC1',
        entries: [video('s1')],
      })).not.toThrow()
    })
  })

  describe('clearing', () => {
    async function populatedStore() {
      const store = buildStore(['UC1', 'UC2', 'UC3'])
      for (const type of FEED_TYPES) {
        for (const channelId of ['UC1', 'UC2', 'UC3']) {
          store.commit(type.mutation, { channelId, entries: [video(`${type.name}-${channelId}`)] })
        }
      }
      return store
    }

    it('clearSubscriptionsCacheForManyChannels deletes the channels in the DB and every feed cache', async () => {
      const store = await populatedStore()

      await store.dispatch('clearSubscriptionsCacheForManyChannels', ['UC1', 'UC3'])

      expect(DBSubscriptionCacheHandlers.deleteMultipleChannels).toHaveBeenCalledWith(['UC1', 'UC3'])
      for (const type of FEED_TYPES) {
        const cache = store.getters[type.getter]
        expect(cache.UC1).toBeNull()
        expect(cache.UC3).toBeNull()
        expect(cache.UC2[type.entryKey]).toEqual([video(`${type.name}-UC2`)])
      }
    })

    it('clearSubscriptionsCacheForManyChannels keeps the cache when the DB delete fails', async () => {
      const store = await populatedStore()
      DBSubscriptionCacheHandlers.deleteMultipleChannels.mockRejectedValue(new Error('nope'))

      await store.dispatch('clearSubscriptionsCacheForManyChannels', ['UC1'])

      expect(store.getters.getVideoCache.UC1).not.toBeNull()
      expect(consoleError).toHaveBeenCalled()
    })

    it('clearSubscriptionsCache wipes the DB and every feed cache but stays ready', async () => {
      const store = await populatedStore()
      store.commit('setSubscriptionCacheReady', true)

      await store.dispatch('clearSubscriptionsCache')

      expect(DBSubscriptionCacheHandlers.deleteAll).toHaveBeenCalledTimes(1)
      for (const getter of ALL_GETTERS) {
        expect(store.getters[getter]).toEqual({})
      }
      expect(store.getters.getSubscriptionCacheReady).toBe(true)
    })

    it('clearSubscriptionsCache keeps the cache when the DB delete fails', async () => {
      const store = await populatedStore()
      DBSubscriptionCacheHandlers.deleteAll.mockRejectedValue(new Error('nope'))

      await store.dispatch('clearSubscriptionsCache')

      expect(Object.keys(store.getters.getVideoCache)).toHaveLength(3)
    })
  })
})
