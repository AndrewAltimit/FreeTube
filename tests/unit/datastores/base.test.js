// Tests for src/datastores/handlers/base.js against real, in-memory NeDB.
//
// src/datastores/index.js opens file-backed datastores, so it is mocked to
// export in-memory ones. The mock exposes getters over `stores`, which is
// refilled with fresh, empty datastores before every test. (base.js reads
// `db.<name>` at call time, so swapping the instances is enough.)

import { beforeEach, describe, expect, it, vi } from 'vitest'
import Datastore from '@seald-io/nedb'

import * as db from '../../../src/datastores/index.js'
import * as handlers from '../../../src/datastores/handlers/base.js'

const DB_NAMES = ['settings', 'profiles', 'playlists', 'history', 'searchHistory', 'subscriptionCache']

const stores = vi.hoisted(() => ({}))

vi.mock('../../../src/datastores/index.js', () => {
  const exports = {}
  for (const name of ['settings', 'profiles', 'playlists', 'history', 'searchHistory', 'subscriptionCache']) {
    Object.defineProperty(exports, name, { enumerable: true, get: () => stores[name] })
  }
  return exports
})

beforeEach(() => {
  for (const name of DB_NAMES) {
    stores[name] = new Datastore({ inMemoryOnly: true })
  }
})

/** Returns every document in a datastore, without NeDB's generated `_id` when asked. */
async function all(store, { stripId = false } = {}) {
  const docs = await store.findAsync({})
  return stripId ? docs.map(({ _id, ...rest }) => rest) : docs
}

describe('test isolation', () => {
  it('starts every test with empty datastores (write)', async () => {
    await db.settings.insertAsync({ _id: 'leak', value: true })
    expect(await all(db.settings)).toHaveLength(1)
  })

  it('starts every test with empty datastores (read)', async () => {
    expect(await all(db.settings)).toEqual([])
  })
})

describe('settings', () => {
  it('upsert inserts a new setting and replaces an existing one', async () => {
    await handlers.settings.upsert('theme', 'dark')
    await handlers.settings.upsert('theme', 'light')
    await handlers.settings.upsert('region', 'US')

    const docs = await db.settings.findAsync({}).sort({ _id: 1 })
    expect(docs).toEqual([
      { _id: 'region', value: 'US' },
      { _id: 'theme', value: 'light' },
    ])
  })

  it('find returns all settings except the window bounds', async () => {
    await handlers.settings.upsert('theme', 'dark')
    await handlers.settings._updateBounds({ x: 1, y: 2, width: 3, height: 4 })

    expect(await handlers.settings.find()).toEqual([{ _id: 'theme', value: 'dark' }])
    expect(await handlers.settings._findOne('bounds')).toEqual({
      _id: 'bounds',
      value: { x: 1, y: 2, width: 3, height: 4 },
    })
  })

  it('_updateBounds overwrites the previous bounds', async () => {
    await handlers.settings._updateBounds({ x: 1 })
    await handlers.settings._updateBounds({ x: 2 })

    expect(await db.settings.findAsync({ _id: 'bounds' })).toEqual([{ _id: 'bounds', value: { x: 2 } }])
  })

  it('_findOne returns null for a missing setting', async () => {
    expect(await handlers.settings._findOne('nope')).toBeNull()
  })

  it('_findAppReadyRelatedSettings returns only the app-ready settings', async () => {
    await handlers.settings.upsert('useProxy', true)
    await handlers.settings.upsert('proxyPort', '9050')
    await handlers.settings.upsert('hideToTrayOnMinimize', false)
    await handlers.settings.upsert('theme', 'dark')

    const ids = (await handlers.settings._findAppReadyRelatedSettings()).map(doc => doc._id).sort()
    expect(ids).toEqual(['hideToTrayOnMinimize', 'proxyPort', 'useProxy'])
  })

  it('_findSidenavSettings returns one pending lookup per sidenav setting', async () => {
    await handlers.settings.upsert('hidePlaylists', true)

    const result = handlers.settings._findSidenavSettings()
    expect(Object.keys(result).sort()).toEqual(['hidePlaylists', 'hidePopularVideos', 'hideTrendingVideos'])
    expect(await result.hidePlaylists).toEqual({ _id: 'hidePlaylists', value: true })
    expect(await result.hideTrendingVideos).toBeNull()
  })

  describe('find migrations', () => {
    async function settingsMap() {
      const docs = await handlers.settings.find()
      return Object.fromEntries(docs.map(doc => [doc._id, doc.value]))
    }

    it('rewrites underscore locales to hyphenated ones', async () => {
      await handlers.settings.upsert('currentLocale', 'en_GB')
      expect(await settingsMap()).toEqual({ currentLocale: 'en-GB' })
    })

    it('leaves hyphenated locales alone', async () => {
      await handlers.settings.upsert('currentLocale', 'pt-BR')
      expect(await settingsMap()).toEqual({ currentLocale: 'pt-BR' })
    })

    it('converts semicolon-separated external player args to a JSON array', async () => {
      await handlers.settings.upsert('externalPlayerCustomArgs', '--a;--b=1')
      expect(await settingsMap()).toEqual({ externalPlayerCustomArgs: '["--a","--b=1"]' })
    })

    it('converts empty external player args to an empty JSON array', async () => {
      await handlers.settings.upsert('externalPlayerCustomArgs', '')
      expect(await settingsMap()).toEqual({ externalPlayerCustomArgs: '[]' })
    })

    it('keeps external player args that are already JSON', async () => {
      await handlers.settings.upsert('externalPlayerCustomArgs', '["--x"]')
      expect(await settingsMap()).toEqual({ externalPlayerCustomArgs: '["--x"]' })
    })

    it('turns defaultTheatreMode=true into defaultViewingMode=theatre and drops it', async () => {
      await handlers.settings.upsert('defaultTheatreMode', true)
      expect(await settingsMap()).toEqual({ defaultViewingMode: 'theatre' })
    })

    it('drops defaultTheatreMode=false without setting a viewing mode', async () => {
      await handlers.settings.upsert('defaultTheatreMode', false)
      await handlers.settings.upsert('defaultViewingMode', 'fullwindow')
      expect(await settingsMap()).toEqual({ defaultViewingMode: 'fullwindow' })
    })

    it('turns saveWatchedProgress=false into watchedProgressSavingMode=never and drops it', async () => {
      await handlers.settings.upsert('saveWatchedProgress', false)
      expect(await settingsMap()).toEqual({ watchedProgressSavingMode: 'never' })
    })

    it('drops saveWatchedProgress=true without setting a saving mode', async () => {
      await handlers.settings.upsert('saveWatchedProgress', true)
      expect(await settingsMap()).toEqual({})
    })

    it('keeps saveWatchedProgress when watchedProgressSavingMode already exists', async () => {
      await handlers.settings.upsert('saveWatchedProgress', false)
      await handlers.settings.upsert('watchedProgressSavingMode', 'auto')
      expect(await settingsMap()).toEqual({ saveWatchedProgress: false, watchedProgressSavingMode: 'auto' })
    })

    it.each([
      [true, 'prompt_folder'],
      [false, 'default_folder'],
    ])('turns screenshotAskPath=%s into screenshotMode=%s and drops it', async (askPath, mode) => {
      await handlers.settings.upsert('screenshotAskPath', askPath)
      expect(await settingsMap()).toEqual({ screenshotMode: mode })
    })
  })
})

describe('history', () => {
  const record = (videoId, timeWatched, extra = {}) => ({ videoId, title: `title ${videoId}`, timeWatched, ...extra })

  it('find returns records newest first', async () => {
    await handlers.history.upsert(record('a', 100))
    await handlers.history.upsert(record('b', 300))
    await handlers.history.upsert(record('c', 200))

    expect((await handlers.history.find()).map(doc => doc.videoId)).toEqual(['b', 'c', 'a'])
  })

  it('upsert replaces the whole record for the same videoId', async () => {
    await handlers.history.upsert(record('a', 100, { watchProgress: 50 }))
    await handlers.history.upsert(record('a', 200))

    expect(await all(db.history, { stripId: true })).toEqual([record('a', 200)])
  })

  it('overwrite replaces every record', async () => {
    await handlers.history.upsert(record('old', 1))
    await handlers.history.overwrite([record('x', 1), record('y', 2)])

    expect((await handlers.history.find()).map(doc => doc.videoId)).toEqual(['y', 'x'])
  })

  it('updateWatchProgress sets progress without touching other fields', async () => {
    await handlers.history.upsert(record('a', 100))
    await handlers.history.updateWatchProgress('a', 42)

    expect(await all(db.history, { stripId: true })).toEqual([record('a', 100, { watchProgress: 42 })])
  })

  it('updateWatchProgress creates a record for an unknown video', async () => {
    await handlers.history.updateWatchProgress('new', 7)

    expect(await all(db.history, { stripId: true })).toEqual([{ videoId: 'new', watchProgress: 7 }])
  })

  it('updateLastViewedPlaylist sets the playlist fields', async () => {
    await handlers.history.upsert(record('a', 100))
    await handlers.history.updateLastViewedPlaylist('a', 'PL1', 'user', 'item1')

    expect(await all(db.history, { stripId: true })).toEqual([
      record('a', 100, { lastViewedPlaylistId: 'PL1', lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: 'item1' }),
    ])
  })

  it('unsetLastViewedPlaylistForVideos clears the fields only for matching videos and playlist', async () => {
    await handlers.history.overwrite([record('a', 1), record('b', 2), record('c', 3)])
    await handlers.history.updateLastViewedPlaylist('a', 'PL1', 'user', 'i1')
    await handlers.history.updateLastViewedPlaylist('b', 'PL1', 'user', 'i2')
    await handlers.history.updateLastViewedPlaylist('c', 'PL2', 'user', 'i3')

    await handlers.history.unsetLastViewedPlaylistForVideos(['a', 'c'], 'PL1')

    const byId = Object.fromEntries((await handlers.history.find()).map(doc => [doc.videoId, doc]))
    expect(byId.a).not.toHaveProperty('lastViewedPlaylistId')
    expect(byId.a).not.toHaveProperty('lastViewedPlaylistType')
    expect(byId.a).not.toHaveProperty('lastViewedPlaylistItemId')
    // b was not in the video list, c points at a different playlist
    expect(byId.b.lastViewedPlaylistId).toBe('PL1')
    expect(byId.c.lastViewedPlaylistId).toBe('PL2')
  })

  it('unsetLastViewedPlaylists clears the fields for every video of the given playlists', async () => {
    await handlers.history.overwrite([record('a', 1), record('b', 2), record('c', 3)])
    await handlers.history.updateLastViewedPlaylist('a', 'PL1', 'user', 'i1')
    await handlers.history.updateLastViewedPlaylist('b', 'PL2', 'user', 'i2')
    await handlers.history.updateLastViewedPlaylist('c', 'PL3', 'user', 'i3')

    await handlers.history.unsetLastViewedPlaylists(['PL1', 'PL2'])

    const byId = Object.fromEntries((await handlers.history.find()).map(doc => [doc.videoId, doc]))
    expect(byId.a).not.toHaveProperty('lastViewedPlaylistId')
    expect(byId.b).not.toHaveProperty('lastViewedPlaylistId')
    expect(byId.c.lastViewedPlaylistId).toBe('PL3')
  })

  it('delete removes one video and deleteAll removes everything', async () => {
    await handlers.history.overwrite([record('a', 1), record('b', 2), record('c', 3)])

    await handlers.history.delete('b')
    expect((await handlers.history.find()).map(doc => doc.videoId)).toEqual(['c', 'a'])

    await handlers.history.deleteAll()
    expect(await handlers.history.find()).toEqual([])
  })
})

describe('profiles', () => {
  const channel = (id) => ({ id, name: `name ${id}`, thumbnail: `thumb ${id}` })

  async function subscriptionIds(profileId) {
    const profile = await db.profiles.findOneAsync({ _id: profileId })
    return profile.subscriptions.map(sub => sub.id)
  }

  beforeEach(async () => {
    await handlers.profiles.create({ _id: 'allChannels', name: 'All', subscriptions: [] })
    await handlers.profiles.create({ _id: 'p1', name: 'One', subscriptions: [] })
    await handlers.profiles.create({ _id: 'p2', name: 'Two', subscriptions: [] })
  })

  it('create returns the inserted profile and find lists all profiles', async () => {
    const created = await handlers.profiles.create({ name: 'Generated', subscriptions: [] })
    expect(created._id).toEqual(expect.any(String))

    const names = (await handlers.profiles.find()).map(profile => profile.name).sort()
    expect(names).toEqual(['All', 'Generated', 'One', 'Two'])
  })

  it('upsert replaces an existing profile and inserts a new one', async () => {
    await handlers.profiles.upsert({ _id: 'p1', name: 'Renamed', subscriptions: [channel('c1')] })
    await handlers.profiles.upsert({ _id: 'p3', name: 'Three', subscriptions: [] })

    expect(await db.profiles.findOneAsync({ _id: 'p1' })).toEqual({ _id: 'p1', name: 'Renamed', subscriptions: [channel('c1')] })
    expect(await db.profiles.findOneAsync({ _id: 'p3' })).toEqual({ _id: 'p3', name: 'Three', subscriptions: [] })
  })

  it('addChannelToProfiles appends to a single profile', async () => {
    await handlers.profiles.addChannelToProfiles(channel('c1'), ['p1'])
    await handlers.profiles.addChannelToProfiles(channel('c2'), ['p1'])

    expect(await subscriptionIds('p1')).toEqual(['c1', 'c2'])
    expect(await subscriptionIds('p2')).toEqual([])
  })

  it('addChannelToProfiles appends to several profiles at once', async () => {
    await handlers.profiles.addChannelToProfiles(channel('c1'), ['allChannels', 'p1', 'p2'])

    expect(await subscriptionIds('allChannels')).toEqual(['c1'])
    expect(await subscriptionIds('p1')).toEqual(['c1'])
    expect(await subscriptionIds('p2')).toEqual(['c1'])
  })

  it('removeChannelFromProfiles removes from a single profile', async () => {
    await handlers.profiles.addChannelToProfiles(channel('c1'), ['p1', 'p2'])
    await handlers.profiles.addChannelToProfiles(channel('c2'), ['p1', 'p2'])

    await handlers.profiles.removeChannelFromProfiles('c1', ['p1'])

    expect(await subscriptionIds('p1')).toEqual(['c2'])
    expect(await subscriptionIds('p2')).toEqual(['c1', 'c2'])
  })

  it('removeChannelFromProfiles removes from several profiles at once', async () => {
    await handlers.profiles.addChannelToProfiles(channel('c1'), ['allChannels', 'p1', 'p2'])
    await handlers.profiles.addChannelToProfiles(channel('c2'), ['allChannels', 'p1', 'p2'])

    await handlers.profiles.removeChannelFromProfiles('c1', ['allChannels', 'p1'])

    expect(await subscriptionIds('allChannels')).toEqual(['c2'])
    expect(await subscriptionIds('p1')).toEqual(['c2'])
    expect(await subscriptionIds('p2')).toEqual(['c1', 'c2'])
  })

  it('delete removes only the given profile', async () => {
    await handlers.profiles.delete('p1')

    const ids = (await handlers.profiles.find()).map(profile => profile._id).sort()
    expect(ids).toEqual(['allChannels', 'p2'])
  })
})

describe('playlists', () => {
  const video = (videoId, playlistItemId = `item-${videoId}`) => ({ videoId, playlistItemId, title: `title ${videoId}` })

  async function getPlaylist(_id) {
    return db.playlists.findOneAsync({ _id })
  }

  async function videoIds(_id) {
    return (await getPlaylist(_id)).videos.map(v => v.videoId)
  }

  beforeEach(async () => {
    await handlers.playlists.create([
      { _id: 'favorites', playlistName: 'Favorites', protected: true, videos: [], lastUpdatedAt: 0 },
      { _id: 'pl1', playlistName: 'One', videos: [video('a'), video('b')], lastUpdatedAt: 0 },
    ])
  })

  it('create inserts several playlists and find lists them', async () => {
    await handlers.playlists.create({ _id: 'pl2', playlistName: 'Two', videos: [] })

    const ids = (await handlers.playlists.find()).map(playlist => playlist._id).sort()
    expect(ids).toEqual(['favorites', 'pl1', 'pl2'])
  })

  it('upsert merges fields into an existing playlist', async () => {
    await handlers.playlists.upsert({ _id: 'pl1', playlistName: 'Renamed', lastUpdatedAt: 5 })

    const playlist = await getPlaylist('pl1')
    expect(playlist.playlistName).toBe('Renamed')
    expect(playlist.lastUpdatedAt).toBe(5)
    // $set keeps fields that were not passed
    expect(playlist.videos.map(v => v.videoId)).toEqual(['a', 'b'])
  })

  it('upsert reorders videos by setting the new array', async () => {
    const { videos } = await getPlaylist('pl1')
    await handlers.playlists.upsert({ _id: 'pl1', videos: [videos[1], videos[0]] })

    expect(await videoIds('pl1')).toEqual(['b', 'a'])
  })

  it('upsert inserts a playlist that does not exist', async () => {
    await handlers.playlists.upsert({ _id: 'pl9', playlistName: 'Nine', videos: [] })

    expect(await getPlaylist('pl9')).toEqual({ _id: 'pl9', playlistName: 'Nine', videos: [] })
  })

  it('upsertVideoByPlaylistId appends one video and bumps lastUpdatedAt', async () => {
    await handlers.playlists.upsertVideoByPlaylistId('pl1', 10, video('c'))

    expect(await videoIds('pl1')).toEqual(['a', 'b', 'c'])
    expect((await getPlaylist('pl1')).lastUpdatedAt).toBe(10)
  })

  it('upsertVideosByPlaylistId appends several videos in order', async () => {
    await handlers.playlists.upsertVideosByPlaylistId('pl1', 11, [video('c'), video('d')])

    expect(await videoIds('pl1')).toEqual(['a', 'b', 'c', 'd'])
    expect((await getPlaylist('pl1')).lastUpdatedAt).toBe(11)
  })

  it('deleteVideoIdByPlaylistId removes by playlistItemId, keeping duplicates of the same video', async () => {
    await handlers.playlists.upsertVideoByPlaylistId('pl1', 1, video('a', 'item-a-2'))

    await handlers.playlists.deleteVideoIdByPlaylistId('pl1', 12, 'a', 'item-a')

    const playlist = await getPlaylist('pl1')
    expect(playlist.videos.map(v => v.playlistItemId)).toEqual(['item-b', 'item-a-2'])
    expect(playlist.lastUpdatedAt).toBe(12)
  })

  it('deleteVideoIdByPlaylistId falls back to removing every entry of the videoId', async () => {
    await handlers.playlists.upsertVideoByPlaylistId('pl1', 1, video('a', 'item-a-2'))

    await handlers.playlists.deleteVideoIdByPlaylistId('pl1', 13, 'a', null)

    expect(await videoIds('pl1')).toEqual(['b'])
    expect((await getPlaylist('pl1')).lastUpdatedAt).toBe(13)
  })

  it('deleteVideoIdByPlaylistId throws when neither id is given', () => {
    expect(() => handlers.playlists.deleteVideoIdByPlaylistId('pl1', 1, null, undefined))
      .toThrow('Both videoId & playlistItemId are absent, _id: pl1')
  })

  it('deleteVideoIdsByPlaylistId removes several items by playlistItemId', async () => {
    await handlers.playlists.upsertVideoByPlaylistId('pl1', 1, video('c'))

    await handlers.playlists.deleteVideoIdsByPlaylistId('pl1', 14, ['item-a', 'item-c'])

    expect(await videoIds('pl1')).toEqual(['b'])
    expect((await getPlaylist('pl1')).lastUpdatedAt).toBe(14)
  })

  it('deleteAllVideosByPlaylistId empties the video list but keeps the playlist', async () => {
    await handlers.playlists.deleteAllVideosByPlaylistId('pl1')

    const playlist = await getPlaylist('pl1')
    expect(playlist.videos).toEqual([])
    expect(playlist.playlistName).toBe('One')
  })

  it('delete removes an unprotected playlist', async () => {
    await handlers.playlists.delete('pl1')
    expect(await getPlaylist('pl1')).toBeNull()
  })

  it('delete refuses to remove a protected playlist', async () => {
    await handlers.playlists.delete('favorites')
    expect(await getPlaylist('favorites')).not.toBeNull()
  })

  it('deleteMultiple never removes protected playlists', async () => {
    await handlers.playlists.deleteMultiple(['favorites'])
    expect(await getPlaylist('favorites')).not.toBeNull()
  })

  // BUG: Playlists.deleteMultiple (src/datastores/handlers/base.js:287-289) calls
  // removeAsync without { multi: true }. NeDB's remove defaults to multi: false, so
  // only the first matching playlist is deleted. The store's removePlaylists action
  // drops all of them from state, so the rest come back after a restart.
  it.fails('deleteMultiple removes every given unprotected playlist', async () => {
    await handlers.playlists.create([
      { _id: 'pl2', playlistName: 'Two', videos: [] },
      { _id: 'pl3', playlistName: 'Three', videos: [] },
    ])

    await handlers.playlists.deleteMultiple(['pl1', 'pl2', 'favorites'])

    const ids = (await handlers.playlists.find()).map(playlist => playlist._id).sort()
    expect(ids).toEqual(['favorites', 'pl3'])
  })

  it('deleteAll removes every playlist, protected or not', async () => {
    await handlers.playlists.deleteAll()
    expect(await handlers.playlists.find()).toEqual([])
  })
})

describe('searchHistory', () => {
  const entry = (_id, lastUpdatedAt) => ({ _id, lastUpdatedAt })

  it('find returns entries most recently updated first', async () => {
    await handlers.searchHistory.upsert(entry('cats', 1))
    await handlers.searchHistory.upsert(entry('dogs', 3))
    await handlers.searchHistory.upsert(entry('fish', 2))

    expect((await handlers.searchHistory.find()).map(e => e._id)).toEqual(['dogs', 'fish', 'cats'])
  })

  it('upsert replaces an entry with the same _id', async () => {
    await handlers.searchHistory.upsert(entry('cats', 1))
    await handlers.searchHistory.upsert(entry('cats', 9))

    expect(await handlers.searchHistory.find()).toEqual([entry('cats', 9)])
  })

  it('overwrite replaces every entry', async () => {
    await handlers.searchHistory.upsert(entry('old', 1))
    await handlers.searchHistory.overwrite([entry('a', 1), entry('b', 2)])

    expect((await handlers.searchHistory.find()).map(e => e._id)).toEqual(['b', 'a'])
  })

  it('delete removes one entry and deleteAll removes everything', async () => {
    await handlers.searchHistory.overwrite([entry('a', 1), entry('b', 2)])

    await handlers.searchHistory.delete('a')
    expect(await handlers.searchHistory.find()).toEqual([entry('b', 2)])

    await handlers.searchHistory.deleteAll()
    expect(await handlers.searchHistory.find()).toEqual([])
  })
})

describe('subscriptionCache', () => {
  const short = (videoId, viewCount, extra = {}) => ({ videoId, title: `t ${videoId}`, author: 'A', viewCount, ...extra })

  async function getChannel(_id) {
    return db.subscriptionCache.findOneAsync({ _id })
  }

  it.each([
    ['updateVideosByChannelId', 'videos', 'videosTimestamp'],
    ['updateLiveStreamsByChannelId', 'liveStreams', 'liveStreamsTimestamp'],
    ['updateShortsByChannelId', 'shorts', 'shortsTimestamp'],
    ['updateCommunityPostsByChannelId', 'communityPosts', 'communityPostsTimestamp'],
  ])('%s creates then replaces %s and its timestamp', async (method, field, timestampField) => {
    await handlers.subscriptionCache[method]('UC1', [{ id: 1 }], 100)
    expect(await getChannel('UC1')).toEqual({ _id: 'UC1', [field]: [{ id: 1 }], [timestampField]: 100 })

    await handlers.subscriptionCache[method]('UC1', [{ id: 2 }, { id: 3 }], 200)
    expect(await getChannel('UC1')).toEqual({ _id: 'UC1', [field]: [{ id: 2 }, { id: 3 }], [timestampField]: 200 })
  })

  it('per-channel updates of different feeds do not clobber each other', async () => {
    await handlers.subscriptionCache.updateVideosByChannelId('UC1', [{ id: 'v' }], 1)
    await handlers.subscriptionCache.updateShortsByChannelId('UC1', [{ id: 's' }], 2)
    await handlers.subscriptionCache.updateLiveStreamsByChannelId('UC1', [{ id: 'l' }], 3)
    await handlers.subscriptionCache.updateCommunityPostsByChannelId('UC1', [{ id: 'p' }], 4)
    await handlers.subscriptionCache.updateVideosByChannelId('UC2', [{ id: 'other' }], 5)

    expect(await getChannel('UC1')).toEqual({
      _id: 'UC1',
      videos: [{ id: 'v' }],
      videosTimestamp: 1,
      shorts: [{ id: 's' }],
      shortsTimestamp: 2,
      liveStreams: [{ id: 'l' }],
      liveStreamsTimestamp: 3,
      communityPosts: [{ id: 'p' }],
      communityPostsTimestamp: 4,
    })
    expect((await handlers.subscriptionCache.find()).map(doc => doc._id).sort()).toEqual(['UC1', 'UC2'])
  })

  describe('updateShortsWithChannelPageShortsByChannelId', () => {
    it('updates title and author, and only raises the view count', async () => {
      await handlers.subscriptionCache.updateShortsByChannelId('UC1', [
        short('s1', 12345),
        short('s2', 12345),
        short('s3', 5),
      ], 100)

      await handlers.subscriptionCache.updateShortsWithChannelPageShortsByChannelId('UC1', [
        // compact count below the exact cached one: keep the cached count
        short('s1', 12000, { title: 'new s1', author: 'B' }),
        // larger count: take it
        short('s2', 15000, { title: 'new s2', author: 'B' }),
        // not in the cache: ignored
        short('s9', 1, { title: 'new s9' }),
      ])

      const channel = await getChannel('UC1')
      expect(channel.shorts).toEqual([
        short('s1', 12345, { title: 'new s1', author: 'B' }),
        short('s2', 15000, { title: 'new s2', author: 'B' }),
        short('s3', 5),
      ])
      expect(channel.shortsTimestamp).toBe(100)
    })

    it('does nothing when the channel has no cached shorts', async () => {
      await handlers.subscriptionCache.updateVideosByChannelId('UC1', [], 1)

      await handlers.subscriptionCache.updateShortsWithChannelPageShortsByChannelId('UC1', [short('s1', 1)])
      await handlers.subscriptionCache.updateShortsWithChannelPageShortsByChannelId('UC404', [short('s1', 1)])

      expect(await getChannel('UC1')).toEqual({ _id: 'UC1', videos: [], videosTimestamp: 1 })
      expect(await getChannel('UC404')).toBeNull()
    })

    it('does not write when no cached short matches', async () => {
      await handlers.subscriptionCache.updateShortsByChannelId('UC1', [short('s1', 1)], 1)
      const updateSpy = vi.spyOn(db.subscriptionCache, 'updateAsync')

      await handlers.subscriptionCache.updateShortsWithChannelPageShortsByChannelId('UC1', [short('other', 99)])

      expect(updateSpy).not.toHaveBeenCalled()
      expect((await getChannel('UC1')).shorts).toEqual([short('s1', 1)])
    })
  })

  it('deleteMultipleChannels removes every given channel', async () => {
    for (const id of ['UC1', 'UC2', 'UC3']) {
      await handlers.subscriptionCache.updateVideosByChannelId(id, [], 1)
    }

    await handlers.subscriptionCache.deleteMultipleChannels(['UC1', 'UC3'])

    expect((await handlers.subscriptionCache.find()).map(doc => doc._id)).toEqual(['UC2'])
  })

  it('deleteAll removes every channel', async () => {
    await handlers.subscriptionCache.updateVideosByChannelId('UC1', [], 1)
    await handlers.subscriptionCache.updateVideosByChannelId('UC2', [], 1)

    await handlers.subscriptionCache.deleteAll()

    expect(await handlers.subscriptionCache.find()).toEqual([])
  })
})

describe('datastore lifecycle helpers', () => {
  // the order loadDatastores / compactAllDatastores use
  const names = ['settings', 'history', 'profiles', 'playlists', 'searchHistory', 'subscriptionCache']

  it('loadDatastores loads all six datastores and settles even if one fails', async () => {
    const spies = names.map(name => vi.spyOn(db[name], 'loadDatabaseAsync'))
    spies[2].mockRejectedValueOnce(new Error('corrupt'))

    const results = await handlers.loadDatastores()

    spies.forEach(spy => expect(spy).toHaveBeenCalledOnce())
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled'])
  })

  it('compactAllDatastores compacts all six datastores', async () => {
    const spies = names.map(name => vi.spyOn(db[name], 'compactDatafileAsync').mockResolvedValue())

    const results = await handlers.compactAllDatastores()

    spies.forEach(spy => expect(spy).toHaveBeenCalledOnce())
    expect(results.every(r => r.status === 'fulfilled')).toBe(true)
  })
})
