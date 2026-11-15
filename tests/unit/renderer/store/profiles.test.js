import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestStore } from './helpers/create-test-store.js'
import { DBProfileHandlers } from '../../../../src/datastores/handlers/index.js'
import profiles from '../../../../src/renderer/store/modules/profiles.js'
import { MAIN_PROFILE_ID } from '../../../../src/constants.js'

vi.mock('../../../../src/datastores/handlers/index.js', async () =>
  (await import('./helpers/db-handlers-mock.js')).createDBHandlersMock())
vi.mock('../../../../src/renderer/i18n/index.js', async () =>
  (await import('./helpers/renderer-mocks.js')).createI18nMock())
vi.mock('../../../../src/renderer/router/index.js', async () =>
  (await import('./helpers/renderer-mocks.js')).createRouterMock())

const YT = 'https://yt3.googleusercontent.com'

function channel(id, extra = {}) {
  return { id, name: `Channel ${id}`, thumbnail: `${YT}/${id}=s176-c-k`, ...extra }
}

function profile(_id, name, subscriptions = [], extra = {}) {
  return { _id, name, bgColor: '#123456', textColor: '#FFFFFF', subscriptions, ...extra }
}

function mainProfile(subscriptions = []) {
  return profile(MAIN_PROFILE_ID, 'All Channels', subscriptions, { bgColor: '#000000' })
}

function buildStore({ profileList, activeProfile, defaultProfile = MAIN_PROFILE_ID } = {}) {
  const profilesState = {}
  if (profileList) profilesState.profileList = profileList
  if (activeProfile) profilesState.activeProfile = activeProfile

  return createTestStore({
    modules: { profiles },
    stubs: { settings: { state: { defaultProfile } } },
    state: { profiles: profilesState },
  })
}

const ids = (list) => list.map((p) => p._id)

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

describe('profiles store module', () => {
  describe('getters', () => {
    it('starts with only the "All Channels" profile active', () => {
      const store = buildStore()

      expect(ids(store.getters.getProfileList)).toEqual([MAIN_PROFILE_ID])
      expect(store.getters.getActiveProfile._id).toBe(MAIN_PROFILE_ID)
      expect(store.getters.getActiveProfile.subscriptions).toEqual([])
    })

    it('getActiveProfile follows the active id and is undefined for an unknown id', () => {
      const store = buildStore({ profileList: [mainProfile(), profile('p1', 'One')] })

      store.dispatch('updateActiveProfile', 'p1')
      expect(store.getters.getActiveProfile.name).toBe('One')

      store.commit('setActiveProfile', 'missing')
      expect(store.getters.getActiveProfile).toBeUndefined()
    })

    it('profileById finds a profile or returns undefined', () => {
      const store = buildStore({ profileList: [mainProfile(), profile('p1', 'One')] })

      expect(store.getters.profileById('p1').name).toBe('One')
      expect(store.getters.profileById('nope')).toBeUndefined()
    })

    it('getSubscribedChannelIdSet uses the first ("All Channels") profile and de-duplicates', () => {
      const store = buildStore({
        profileList: [
          mainProfile([channel('UC1'), channel('UC2'), channel('UC1')]),
          profile('p1', 'One', [channel('UConlyHere')]),
        ],
      })

      const set = store.getters.getSubscribedChannelIdSet
      expect(set).toBeInstanceOf(Set)
      expect([...set]).toEqual(['UC1', 'UC2'])
    })
  })

  describe('grabAllProfiles', () => {
    it('creates and persists a default "All Channels" profile when the DB is empty', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0) // first colour: Red #d50000
      DBProfileHandlers.find.mockResolvedValue([])
      const store = buildStore()

      await store.dispatch('grabAllProfiles', 'Translated All Channels')

      const expected = {
        _id: MAIN_PROFILE_ID,
        name: 'Translated All Channels',
        bgColor: '#d50000',
        textColor: '#FFFFFF',
        subscriptions: [],
      }
      expect(DBProfileHandlers.create).toHaveBeenCalledWith(expected)
      expect(store.getters.getProfileList).toEqual([expected])
    })

    it('keeps the placeholder list when creating the default profile fails', async () => {
      DBProfileHandlers.find.mockResolvedValue([])
      DBProfileHandlers.create.mockRejectedValue(new Error('nope'))
      const store = buildStore()

      await store.dispatch('grabAllProfiles', 'All')

      expect(store.getters.getProfileList[0].name).toBe('All Channels')
      expect(consoleError).toHaveBeenCalled()
    })

    it('puts the main profile first and sorts the rest naturally by name', async () => {
      DBProfileHandlers.find.mockResolvedValue([
        profile('p10', 'Profile 10'),
        profile('pb', 'beta'),
        profile('p2', 'Profile 2'),
        mainProfile(),
        profile('pa', 'Alpha'),
      ])
      const store = buildStore()

      await store.dispatch('grabAllProfiles')

      expect(store.getters.getProfileList.map((p) => p.name))
        .toEqual(['All Channels', 'Alpha', 'beta', 'Profile 2', 'Profile 10'])
    })

    it('activates the default profile setting on first load', async () => {
      DBProfileHandlers.find.mockResolvedValue([mainProfile(), profile('p1', 'One')])
      const store = buildStore({ defaultProfile: 'p1' })

      await store.dispatch('grabAllProfiles')

      expect(store.getters.getActiveProfile._id).toBe('p1')
    })

    it('stays on the main profile when the default profile no longer exists', async () => {
      DBProfileHandlers.find.mockResolvedValue([mainProfile(), profile('p1', 'One')])
      const store = buildStore({ defaultProfile: 'deleted' })

      await store.dispatch('grabAllProfiles')

      expect(store.getters.getActiveProfile._id).toBe(MAIN_PROFILE_ID)
    })

    it('does not override the active profile when reloading an already loaded list', async () => {
      const list = [mainProfile(), profile('p1', 'One'), profile('p2', 'Two')]
      DBProfileHandlers.find.mockResolvedValue(list)
      const store = buildStore({ profileList: list, activeProfile: 'p2', defaultProfile: 'p1' })

      await store.dispatch('grabAllProfiles')

      expect(store.getters.getActiveProfile._id).toBe('p2')
    })

    it.each([
      ['rejects', () => DBProfileHandlers.find.mockRejectedValue(new Error('db'))],
      ['returns a non-array', () => DBProfileHandlers.find.mockResolvedValue(null)],
    ])('leaves the list untouched when the DB %s', async (_, arrange) => {
      arrange()
      const store = buildStore()

      await store.dispatch('grabAllProfiles', 'All')

      expect(ids(store.getters.getProfileList)).toEqual([MAIN_PROFILE_ID])
      expect(DBProfileHandlers.create).not.toHaveBeenCalled()
    })
  })

  describe('createProfile / updateProfile / removeProfile', () => {
    it('createProfile adds the profile returned by the DB, keeping sort order', async () => {
      const store = buildStore({ profileList: [mainProfile(), profile('pz', 'Zed')] })
      const input = profile(undefined, 'Middle')
      DBProfileHandlers.create.mockResolvedValue({ ...input, _id: 'generated' })

      await store.dispatch('createProfile', input)

      expect(DBProfileHandlers.create).toHaveBeenCalledWith(input)
      expect(ids(store.getters.getProfileList)).toEqual([MAIN_PROFILE_ID, 'generated', 'pz'])
    })

    it('createProfile does not add anything when the DB write fails', async () => {
      const store = buildStore()
      DBProfileHandlers.create.mockRejectedValue(new Error('nope'))

      await store.dispatch('createProfile', profile(undefined, 'X'))

      expect(store.getters.getProfileList).toHaveLength(1)
    })

    it('updateProfile replaces the profile by id and re-sorts after a rename', async () => {
      const store = buildStore({ profileList: [mainProfile(), profile('pa', 'Alpha'), profile('pb', 'Beta')] })
      const renamed = profile('pa', 'Zulu', [channel('UC1')])

      await store.dispatch('updateProfile', renamed)

      expect(DBProfileHandlers.upsert).toHaveBeenCalledWith(renamed)
      expect(ids(store.getters.getProfileList)).toEqual([MAIN_PROFILE_ID, 'pb', 'pa'])
      expect(store.getters.profileById('pa')).toEqual(renamed)
      expect(store.getters.getProfileList).toHaveLength(3)
    })

    it('updateProfile inserts a profile that is not in the list yet', async () => {
      const store = buildStore()

      await store.dispatch('updateProfile', profile('new', 'New'))

      expect(ids(store.getters.getProfileList)).toEqual([MAIN_PROFILE_ID, 'new'])
    })

    it('updateProfile leaves state alone when the DB write fails', async () => {
      const store = buildStore({ profileList: [mainProfile(), profile('pa', 'Alpha')] })
      DBProfileHandlers.upsert.mockRejectedValue(new Error('nope'))

      await store.dispatch('updateProfile', profile('pa', 'Changed'))

      expect(store.getters.profileById('pa').name).toBe('Alpha')
    })

    it('removeProfile deletes it from the DB and the list', async () => {
      const store = buildStore({ profileList: [mainProfile(), profile('pa', 'Alpha'), profile('pb', 'Beta')] })

      await store.dispatch('removeProfile', 'pa')

      expect(DBProfileHandlers.delete).toHaveBeenCalledWith('pa')
      expect(ids(store.getters.getProfileList)).toEqual([MAIN_PROFILE_ID, 'pb'])
    })

    // Regression: `removeProfileFromList` used to splice `findIndex(...)`
    // without checking for -1, so an id that is not in the list removed the
    // LAST profile instead. Reachable via the cross-window DELETE sync event for a profile this
    // window no longer has, or a double removal.
    it('removeProfileFromList ignores an id that is not in the list', () => {
      const store = buildStore({ profileList: [mainProfile(), profile('pa', 'Alpha'), profile('pb', 'Beta')] })

      store.commit('removeProfileFromList', 'missing')

      expect(ids(store.getters.getProfileList)).toEqual([MAIN_PROFILE_ID, 'pa', 'pb'])
    })
  })

  describe('addChannelToProfiles (subscribe)', () => {
    it('persists and appends the channel to exactly the given profiles', async () => {
      const store = buildStore({
        profileList: [mainProfile([channel('UC0')]), profile('pa', 'A'), profile('pb', 'B')],
      })
      const ch = channel('UC1')

      await store.dispatch('addChannelToProfiles', { channel: ch, profileIds: [MAIN_PROFILE_ID, 'pa'] })

      expect(DBProfileHandlers.addChannelToProfiles).toHaveBeenCalledWith(ch, [MAIN_PROFILE_ID, 'pa'])
      expect(store.getters.profileById(MAIN_PROFILE_ID).subscriptions.map((c) => c.id)).toEqual(['UC0', 'UC1'])
      expect(store.getters.profileById('pa').subscriptions.map((c) => c.id)).toEqual(['UC1'])
      expect(store.getters.profileById('pb').subscriptions).toEqual([])
      expect(store.getters.getSubscribedChannelIdSet.has('UC1')).toBe(true)
    })

    it('rewrites Invidious ggpht thumbnails to the YouTube host before saving', async () => {
      const store = buildStore()
      const ch = channel('UC1', { thumbnail: 'https://inv.example.com/ggpht/abc=s176' })

      await store.dispatch('addChannelToProfiles', { channel: ch, profileIds: [MAIN_PROFILE_ID] })

      const saved = DBProfileHandlers.addChannelToProfiles.mock.calls[0][0]
      expect(saved.thumbnail).toBe(`${YT}/abc=s176`)
      expect(store.getters.getActiveProfile.subscriptions[0].thumbnail).toBe(`${YT}/abc=s176`)
    })

    it('leaves YouTube thumbnails as they are', async () => {
      const store = buildStore()
      const ch = channel('UC1', { thumbnail: `${YT}/ggpht/xyz=s88` })

      await store.dispatch('addChannelToProfiles', { channel: ch, profileIds: [MAIN_PROFILE_ID] })

      expect(DBProfileHandlers.addChannelToProfiles.mock.calls[0][0].thumbnail).toBe(`${YT}/ggpht/xyz=s88`)
    })

    // The store does not de-duplicate; callers are expected to check first.
    // removeChannelFromProfiles is written to cope with the duplicates.
    it('does not de-duplicate a channel that is already subscribed', async () => {
      const store = buildStore({ profileList: [mainProfile([channel('UC1')])] })

      await store.dispatch('addChannelToProfiles', { channel: channel('UC1'), profileIds: [MAIN_PROFILE_ID] })

      expect(store.getters.getActiveProfile.subscriptions).toHaveLength(2)
      expect(store.getters.getSubscribedChannelIdSet.size).toBe(1)
    })

    it('does not touch state when the DB write fails', async () => {
      const store = buildStore()
      DBProfileHandlers.addChannelToProfiles.mockRejectedValue(new Error('nope'))

      await store.dispatch('addChannelToProfiles', { channel: channel('UC1'), profileIds: [MAIN_PROFILE_ID] })

      expect(store.getters.getActiveProfile.subscriptions).toEqual([])
      expect(consoleError).toHaveBeenCalled()
    })

    it('logs instead of throwing for an unknown profile id', async () => {
      const store = buildStore()

      await expect(store.dispatch('addChannelToProfiles', {
        channel: channel('UC1'),
        profileIds: ['missing'],
      })).resolves.toBeUndefined()
      expect(consoleError).toHaveBeenCalled()
    })
  })

  describe('removeChannelFromProfiles (unsubscribe)', () => {
    it('persists and removes every copy of the channel from the given profiles only', async () => {
      const store = buildStore({
        profileList: [
          mainProfile([channel('UC1'), channel('UC2'), channel('UC1')]),
          profile('pa', 'A', [channel('UC1')]),
          profile('pb', 'B', [channel('UC1')]),
        ],
      })

      await store.dispatch('removeChannelFromProfiles', { channelId: 'UC1', profileIds: [MAIN_PROFILE_ID, 'pa'] })

      expect(DBProfileHandlers.removeChannelFromProfiles).toHaveBeenCalledWith('UC1', [MAIN_PROFILE_ID, 'pa'])
      expect(store.getters.profileById(MAIN_PROFILE_ID).subscriptions.map((c) => c.id)).toEqual(['UC2'])
      expect(store.getters.profileById('pa').subscriptions).toEqual([])
      expect(store.getters.profileById('pb').subscriptions.map((c) => c.id)).toEqual(['UC1'])
      expect(store.getters.getSubscribedChannelIdSet.has('UC1')).toBe(false)
    })

    it('replaces the subscriptions array rather than mutating it in place', async () => {
      const store = buildStore({ profileList: [mainProfile([channel('UC1'), channel('UC2')])] })
      const before = store.getters.getActiveProfile.subscriptions

      await store.dispatch('removeChannelFromProfiles', { channelId: 'UC1', profileIds: [MAIN_PROFILE_ID] })

      expect(store.getters.getActiveProfile.subscriptions).not.toBe(before)
      expect(before.map((c) => c.id)).toEqual(['UC1', 'UC2'])
    })

    it('is a no-op for a channel that is not subscribed', async () => {
      const store = buildStore({ profileList: [mainProfile([channel('UC1')])] })

      await store.dispatch('removeChannelFromProfiles', { channelId: 'UCx', profileIds: [MAIN_PROFILE_ID] })

      expect(store.getters.getActiveProfile.subscriptions.map((c) => c.id)).toEqual(['UC1'])
    })

    it('does not touch state when the DB write fails', async () => {
      const store = buildStore({ profileList: [mainProfile([channel('UC1')])] })
      DBProfileHandlers.removeChannelFromProfiles.mockRejectedValue(new Error('nope'))

      await store.dispatch('removeChannelFromProfiles', { channelId: 'UC1', profileIds: [MAIN_PROFILE_ID] })

      expect(store.getters.getActiveProfile.subscriptions).toHaveLength(1)
    })
  })

  describe('updateSubscriptionDetails', () => {
    it('updates name and normalised thumbnail in every profile that has the channel', async () => {
      const store = buildStore({
        profileList: [
          mainProfile([channel('UC1'), channel('UC2')]),
          profile('pa', 'A', [channel('UC1')]),
          profile('pb', 'B', [channel('UC2')]),
        ],
      })

      await store.dispatch('updateSubscriptionDetails', {
        channelId: 'UC1',
        channelName: 'Renamed',
        channelThumbnailUrl: 'https://inv.example.com/ggpht/new=s48-c-k',
      })

      const expectedThumb = `${YT}/new=s176-c-k`
      expect(DBProfileHandlers.upsert).toHaveBeenCalledTimes(2)
      expect(ids(DBProfileHandlers.upsert.mock.calls.map(([p]) => p))).toEqual([MAIN_PROFILE_ID, 'pa'])
      for (const id of [MAIN_PROFILE_ID, 'pa']) {
        const ch = store.getters.profileById(id).subscriptions.find((c) => c.id === 'UC1')
        expect(ch).toEqual({ id: 'UC1', name: 'Renamed', thumbnail: expectedThumb })
      }
      expect(store.getters.profileById(MAIN_PROFILE_ID).subscriptions[1]).toEqual(channel('UC2'))
    })

    it('does not mutate the previous profile objects (copies before changing)', async () => {
      const store = buildStore({ profileList: [mainProfile([channel('UC1')])] })
      const before = store.getters.getActiveProfile

      await store.dispatch('updateSubscriptionDetails', { channelId: 'UC1', channelName: 'Renamed' })

      expect(before.subscriptions[0].name).toBe('Channel UC1')
      expect(store.getters.getActiveProfile).not.toBe(before)
      expect(store.getters.getActiveProfile.subscriptions[0].name).toBe('Renamed')
    })

    it('does not write anything when nothing changed', async () => {
      const store = buildStore({ profileList: [mainProfile([channel('UC1')])] })

      await store.dispatch('updateSubscriptionDetails', {
        channelId: 'UC1',
        channelName: 'Channel UC1',
        channelThumbnailUrl: `${YT}/UC1=s88-c-k`, // normalises to the stored =s176 URL
      })

      expect(DBProfileHandlers.upsert).not.toHaveBeenCalled()
    })

    it('ignores a null name and a missing thumbnail', async () => {
      const store = buildStore({ profileList: [mainProfile([channel('UC1')])] })

      await store.dispatch('updateSubscriptionDetails', { channelId: 'UC1', channelName: null })

      expect(DBProfileHandlers.upsert).not.toHaveBeenCalled()
    })

    // Optimisation: once a profile that has the channel needed no update, the
    // remaining profiles are assumed to be up to date too and are skipped.
    it('stops at the first profile whose copy of the channel is already current', async () => {
      const store = buildStore({
        profileList: [
          mainProfile([channel('UC1', { name: 'Current' })]),
          profile('pa', 'A', [channel('UC1', { name: 'Stale' })]),
        ],
      })

      await store.dispatch('updateSubscriptionDetails', { channelId: 'UC1', channelName: 'Current' })

      expect(DBProfileHandlers.upsert).not.toHaveBeenCalled()
      expect(store.getters.profileById('pa').subscriptions[0].name).toBe('Stale')
    })
  })

  describe('batchUpdateSubscriptionDetails', () => {
    it('does nothing for an empty list', async () => {
      const store = buildStore({ profileList: [mainProfile([channel('UC1')])] })

      await store.dispatch('batchUpdateSubscriptionDetails', [])

      expect(DBProfileHandlers.upsert).not.toHaveBeenCalled()
    })

    it('writes each changed profile once, covering several channels', async () => {
      const store = buildStore({
        profileList: [
          mainProfile([channel('UC1'), channel('UC2'), channel('UC3')]),
          profile('pa', 'A', [channel('UC3')]),
          profile('pb', 'B', [channel('UC2')]),
        ],
      })

      await store.dispatch('batchUpdateSubscriptionDetails', [
        { channelId: 'UC1', channelName: 'One', channelThumbnailUrl: null },
        { channelId: 'UC2', channelName: null, channelThumbnailUrl: 'https://inv.example.com/ggpht/two=s88' },
        { channelId: 'UCnotSubscribed', channelName: 'X', channelThumbnailUrl: null },
      ])

      expect(ids(DBProfileHandlers.upsert.mock.calls.map(([p]) => p))).toEqual([MAIN_PROFILE_ID, 'pb'])

      const main = store.getters.profileById(MAIN_PROFILE_ID)
      expect(main.subscriptions).toEqual([
        channel('UC1', { name: 'One' }),
        channel('UC2', { thumbnail: `${YT}/two=s176` }),
        channel('UC3'),
      ])
      expect(store.getters.profileById('pb').subscriptions[0].thumbnail).toBe(`${YT}/two=s176`)
      expect(store.getters.profileById('pa').subscriptions).toEqual([channel('UC3')])
    })

    it('keeps checking later profiles even when an earlier one was already current', async () => {
      const store = buildStore({
        profileList: [
          mainProfile([channel('UC1', { name: 'Current' })]),
          profile('pa', 'A', [channel('UC1', { name: 'Stale' })]),
        ],
      })

      await store.dispatch('batchUpdateSubscriptionDetails', [{ channelId: 'UC1', channelName: 'Current' }])

      expect(ids(DBProfileHandlers.upsert.mock.calls.map(([p]) => p))).toEqual(['pa'])
      expect(store.getters.profileById('pa').subscriptions[0].name).toBe('Current')
    })

    it('does not mutate the previous profile objects', async () => {
      const store = buildStore({ profileList: [mainProfile([channel('UC1')])] })
      const before = store.getters.getActiveProfile

      await store.dispatch('batchUpdateSubscriptionDetails', [{ channelId: 'UC1', channelName: 'Renamed' }])

      expect(before.subscriptions[0].name).toBe('Channel UC1')
      expect(store.getters.getActiveProfile.subscriptions[0].name).toBe('Renamed')
    })
  })
})
