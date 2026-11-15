// Only the self-contained parts of utils.js: state flags, caches and the
// screenshot filename / playlist-prompt validation. URL parsing, region data
// (fetch) and external player data are left to other suites.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestStore } from './helpers/create-test-store.js'
import utils from '../../../../src/renderer/store/modules/utils.js'

vi.mock('../../../../src/renderer/i18n/index.js', async () =>
  (await import('./helpers/renderer-mocks.js')).createI18nMock())
vi.mock('../../../../src/renderer/router/index.js', async () =>
  (await import('./helpers/renderer-mocks.js')).createRouterMock())

function buildStore(screenshotFilenamePattern = '%Y%M%D-%H%N%S') {
  return createTestStore({
    modules: { utils },
    stubs: { settings: { state: { screenshotFilenamePattern } } },
  })
}

let consoleError

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('utils store module', () => {
  describe('subscription first auto-fetch flags', () => {
    it.each([
      ['Videos'],
      ['LiveStreams'],
      ['Shorts'],
      ['Posts'],
    ])('%s flag starts false and is set independently of the others', (feed) => {
      const store = buildStore()
      const all = ['Videos', 'LiveStreams', 'Shorts', 'Posts']

      for (const name of all) {
        expect(store.getters[`getSubscriptionFor${name}FirstAutoFetchRun`]).toBe(false)
      }

      store.commit(`setSubscriptionFor${feed}FirstAutoFetchRun`)

      for (const name of all) {
        expect(store.getters[`getSubscriptionFor${name}FirstAutoFetchRun`]).toBe(name === feed)
      }
    })

    it('is per store (window), not shared between stores', () => {
      buildStore().commit('setSubscriptionForVideosFirstAutoFetchRun')

      expect(buildStore().getters.getSubscriptionForVideosFirstAutoFetchRun).toBe(false)
    })
  })

  describe('prompts and simple flags', () => {
    it('tracks open prompts by id', () => {
      const store = buildStore()
      expect(store.getters.isAnyPromptOpen).toBe(false)

      store.commit('addOpenPrompt', 'a')
      store.commit('addOpenPrompt', 'b')
      store.commit('addOpenPrompt', 'a')
      store.commit('removeOpenPrompt', 'a')
      expect(store.getters.isAnyPromptOpen).toBe(true)

      store.commit('removeOpenPrompt', 'b')
      expect(store.getters.isAnyPromptOpen).toBe(false)
    })

    it('toggleSideNav flips the side nav and outlines actions set the flag', async () => {
      const store = buildStore()

      store.commit('toggleSideNav')
      expect(store.getters.getIsSideNavOpen).toBe(true)
      store.commit('toggleSideNav')
      expect(store.getters.getIsSideNavOpen).toBe(false)

      await store.dispatch('showOutlines')
      expect(store.getters.getOutlinesHidden).toBe(false)
      await store.dispatch('hideOutlines')
      expect(store.getters.getOutlinesHidden).toBe(true)
    })
  })

  describe('caches', () => {
    it('trending cache and refresh timestamps are kept per page', () => {
      const store = buildStore()
      const ts = new Date()

      store.commit('setTrendingCache', { page: 'gaming', value: ['g'] })
      store.commit('setTrendingCache', { page: 'sports', value: ['s'] })
      store.commit('setLastTrendingRefreshTimestamp', { page: 'gaming', timestamp: ts })
      store.commit('clearTrendingCache', 'sports')

      expect(store.getters.getTrendingCache).toEqual({ gaming: ['g'], sports: null, podcasts: null })
      expect(store.getters.getLastTrendingRefreshTimestamp).toEqual({ gaming: ts, sports: '', podcasts: '' })
    })

    it('addVideoToDeArrowCache keeps the first entry; addThumbnailToDeArrowCache overwrites', () => {
      const store = buildStore()

      store.commit('addVideoToDeArrowCache', { videoId: 'v', title: 'first' })
      store.commit('addVideoToDeArrowCache', { videoId: 'v', title: 'second' })
      expect(store.getters.getDeArrowCache.v.title).toBe('first')

      store.commit('addThumbnailToDeArrowCache', { videoId: 'v', thumbnail: 't' })
      expect(store.getters.getDeArrowCache.v).toEqual({ videoId: 'v', thumbnail: 't' })
    })
  })

  describe('session search history', () => {
    const filters = (extra = {}) => ({ prioritize: 'relevance', time: '', type: 'all', duration: '', features: [], ...extra })

    it('updates an existing search with the same query and filters instead of adding one', () => {
      const store = buildStore()
      store.commit('addToSessionSearchHistory', { query: 'q', searchSettings: filters(), data: [1], nextPageRef: 'r1' })

      store.commit('addToSessionSearchHistory', { query: 'q', searchSettings: filters(), data: [1, 2], nextPageRef: 'r2' })

      expect(store.getters.getSessionSearchHistory).toEqual([
        { query: 'q', searchSettings: filters(), data: [1, 2], nextPageRef: 'r2' },
      ])
    })

    it('keeps the Invidious searchPage when there is no nextPageRef', () => {
      const store = buildStore()
      store.commit('addToSessionSearchHistory', { query: 'q', searchSettings: filters(), data: [], searchPage: 1 })

      store.commit('addToSessionSearchHistory', { query: 'q', searchSettings: filters(), data: [], searchPage: 2 })

      expect(store.getters.getSessionSearchHistory[0].searchPage).toBe(2)
    })

    it('treats different filters (including feature order) as a different search', () => {
      const store = buildStore()
      store.commit('addToSessionSearchHistory', { query: 'q', searchSettings: filters({ features: ['hd', '4k'] }), data: [] })
      store.commit('addToSessionSearchHistory', { query: 'q', searchSettings: filters({ features: ['4k', 'hd'] }), data: [] })
      store.commit('addToSessionSearchHistory', { query: 'q', searchSettings: filters({ type: 'video' }), data: [] })

      expect(store.getters.getSessionSearchHistory).toHaveLength(3)
    })

    it('removeFromSessionSearchHistory removes every entry for the query', () => {
      const store = buildStore()
      store.commit('addToSessionSearchHistory', { query: 'q', searchSettings: filters(), data: [] })
      store.commit('addToSessionSearchHistory', { query: 'q', searchSettings: filters({ type: 'video' }), data: [] })
      store.commit('addToSessionSearchHistory', { query: 'other', searchSettings: filters(), data: [] })

      store.commit('removeFromSessionSearchHistory', 'q')

      expect(store.getters.getSessionSearchHistory.map((s) => s.query)).toEqual(['other'])
    })
  })

  describe('parseScreenshotCustomFileName', () => {
    const date = new Date(2026, 0, 2, 3, 4, 5, 6)

    it('substitutes every placeholder with zero padding', async () => {
      const store = buildStore()

      const name = await store.dispatch('parseScreenshotCustomFileName', {
        pattern: '%Y-%M-%D_%H-%N-%S.%T_%i_%s.%t',
        date,
        playerTime: 75,
        videoId: 'abc123',
      })

      expect(name).toBe('2026-01-02_03-04-05.006_abc123_75.000')
    })

    it('defaults to the pattern from settings', async () => {
      const store = buildStore('%i-%Y')

      const name = await store.dispatch('parseScreenshotCustomFileName', { date, playerTime: 0, videoId: 'vid' })

      expect(name).toBe('vid-2026')
    })

    it('rejects names containing characters the OS forbids', async () => {
      const store = buildStore()

      // synchronous action: Vuex rethrows synchronously instead of rejecting
      expect(() => store.dispatch('parseScreenshotCustomFileName', {
        pattern: 'a/b',
        date,
        playerTime: 0,
        videoId: 'v',
      })).toThrow('Settings.Player Settings.Screenshot.Error.Forbidden Characters')
    })

    it('rejects an empty name', async () => {
      const store = buildStore()

      // synchronous action: Vuex rethrows synchronously instead of rejecting
      expect(() => store.dispatch('parseScreenshotCustomFileName', {
        pattern: '',
        date,
        playerTime: 0,
        videoId: 'v',
      })).toThrow('Settings.Player Settings.Screenshot.Error.Empty File Name')
    })

    // Regression: %t used to be built with
    // `(playerTime % 1).toString().slice(2, 5)` and no padding, so 12.5s gave
    // '5' instead of the documented 3-digit '500'.
    it('%t is always three digits of milliseconds', async () => {
      const store = buildStore()

      const name = await store.dispatch('parseScreenshotCustomFileName', {
        pattern: '%s.%t',
        date,
        playerTime: 12.5,
        videoId: 'v',
      })

      expect(name).toBe('12.500')
    })
  })

  describe('showAddToPlaylistPromptForManyVideos', () => {
    const valid = (id) => ({ videoId: id, title: 't', lengthSeconds: 1 })

    it('opens the prompt with the videos and default properties', async () => {
      const store = buildStore()
      const videos = [valid('a'), valid('b')]

      await store.dispatch('showAddToPlaylistPromptForManyVideos', { videos, newPlaylistDefaultProperties: { title: 'X' } })

      expect(store.getters.getShowAddToPlaylistPrompt).toBe(true)
      expect(store.getters.getToBeAddedToPlaylistVideoList).toEqual(videos)
      expect(store.getters.getNewPlaylistDefaultProperties).toEqual({ title: 'X' })
    })

    it.each([
      ['not an array', { videoId: 'a' }],
      ['missing a required key', [valid('a'), { videoId: 'b', title: 't' }]],
    ])('throws and keeps the prompt closed when videos are %s', async (_, videos) => {
      const store = buildStore()

      expect(() => store.dispatch('showAddToPlaylistPromptForManyVideos', { videos }))
        .toThrow('Incorrect videos data passed when opening playlist prompt')
      expect(store.getters.getShowAddToPlaylistPrompt).toBe(false)
    })

    it('hideAddToPlaylistPrompt closes the prompt and resets the default properties', async () => {
      const store = buildStore()
      await store.dispatch('showAddToPlaylistPromptForManyVideos', { videos: [valid('a')], newPlaylistDefaultProperties: { title: 'X' } })

      await store.dispatch('hideAddToPlaylistPrompt')

      expect(store.getters.getShowAddToPlaylistPrompt).toBe(false)
      expect(store.getters.getNewPlaylistDefaultProperties).toEqual({})
    })
  })
})
