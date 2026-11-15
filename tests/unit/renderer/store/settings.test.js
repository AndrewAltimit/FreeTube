import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestStore } from './helpers/create-test-store.js'
import { DBSettingHandlers } from '../../../../src/datastores/handlers/index.js'
import i18n, { loadLocale } from '../../../../src/renderer/i18n/index.js'
import { getSystemLocale, showToast } from '../../../../src/renderer/helpers/utils.js'
import settings, { defaultUpdaterId, NON_TRANSFERABLE_SETTINGS } from '../../../../src/renderer/store/modules/settings.js'

vi.mock('../../../../src/datastores/handlers/index.js', async () =>
  (await import('./helpers/db-handlers-mock.js')).createDBHandlersMock())
vi.mock('../../../../src/renderer/i18n/index.js', async () =>
  (await import('./helpers/renderer-mocks.js')).createI18nMock())
// settings.js only needs these two; the real module would pull in the router
vi.mock('../../../../src/renderer/helpers/utils.js', () => ({
  getSystemLocale: vi.fn(async () => 'en-US'),
  showToast: vi.fn(),
}))

// side-effect triggers are dispatched without being awaited
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

function buildStore(settingsState = {}) {
  const getRegionData = vi.fn()
  const setCurrentInvidiousInstance = vi.fn((state, value) => { state.currentInvidiousInstance = value })

  const store = createTestStore({
    modules: { settings },
    state: { settings: settingsState },
    stubs: {
      // stands in for utils.js (root action used by the currentLocale side effect)
      utils: { actions: { getRegionData } },
      // stands in for invidious.js (used by the defaultInvidiousInstance side effect)
      invidious: {
        state: { currentInvidiousInstance: 'https://current.example' },
        mutations: { setCurrentInvidiousInstance },
      },
    },
  })

  return { store, getRegionData, setCurrentInvidiousInstance }
}

const upsertCalls = () => DBSettingHandlers.upsert.mock.calls

let consoleError

beforeEach(() => {
  vi.resetAllMocks()
  i18n.global.locale.value = 'en-US'
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('settings store module', () => {
  describe('generated getters, mutations and actions', () => {
    it('generates get/set/update for every setting in state', () => {
      const { store } = buildStore()
      const settingIds = Object.keys(store.state.settings)

      expect(settingIds.length).toBeGreaterThan(100)
      for (const id of settingIds) {
        const suffix = id.charAt(0).toUpperCase() + id.slice(1)
        expect(store.getters, `getter for ${id}`).toHaveProperty(`get${suffix}`)
        // Vuex has no public API to list registered types
        expect(store._mutations, `mutation for ${id}`).toHaveProperty(`set${suffix}`)
        expect(store._actions, `action for ${id}`).toHaveProperty(defaultUpdaterId(id))
      }
    })

    it('generates trigger actions only for settings with side effects', () => {
      const { store } = buildStore()

      for (const id of ['currentLocale', 'defaultInvidiousInstance', 'defaultVolume', 'uiScale', 'maxVideoPlaybackRate', 'videoPlaybackRateInterval']) {
        const suffix = id.charAt(0).toUpperCase() + id.slice(1)
        expect(store._actions).toHaveProperty(`trigger${suffix}SideEffects`)
      }
      expect(store._actions).not.toHaveProperty('triggerRegionSideEffects')
    })

    it('defaultUpdaterId builds the action name', () => {
      expect(defaultUpdaterId('hideWatchedSubs')).toBe('updateHideWatchedSubs')
    })

    it('update persists the value with the setting id and then commits it', async () => {
      const { store } = buildStore()
      expect(store.getters.getRegion).toBe('US')

      await store.dispatch('updateRegion', 'DE')

      expect(upsertCalls()).toEqual([['region', 'DE']])
      expect(store.getters.getRegion).toBe('DE')
    })

    it('update round-trips object-valued settings', async () => {
      const { store } = buildStore()
      const value = { color: 'Red', skip: 'promptToSkip' }

      await store.dispatch('updateSponsorBlockSponsor', value)

      expect(upsertCalls()).toEqual([['sponsorBlockSponsor', value]])
      expect(store.getters.getSponsorBlockSponsor).toEqual(value)
    })

    it('update leaves the value unchanged when the DB write fails', async () => {
      const { store } = buildStore()
      DBSettingHandlers.upsert.mockRejectedValue(new Error('db'))

      await store.dispatch('updateHideWatchedSubs', true)

      expect(store.getters.getHideWatchedSubs).toBe(false)
      expect(consoleError).toHaveBeenCalled()
    })

    it('a side-effect setting is not applied (and has no side effect) when the DB write fails', async () => {
      const { store } = buildStore()
      DBSettingHandlers.upsert.mockRejectedValue(new Error('db'))

      await store.dispatch('updateDefaultVolume', 0.3)

      expect(store.getters.getDefaultVolume).toBe(1)
      expect(sessionStorage.getItem('volume')).toBeNull()
    })

    it('uses the Local API backend by default when SUPPORTS_LOCAL_API is set', () => {
      const { store } = buildStore()

      expect(store.getters.getBackendPreference).toBe('local')
      expect(store.getters.getProxyVideos).toBe(false)
    })
  })

  describe('side effects', () => {
    it('defaultVolume stores volume and mute state in sessionStorage', async () => {
      const { store } = buildStore()

      await store.dispatch('updateDefaultVolume', 0.4)

      expect(store.getters.getDefaultVolume).toBe(0.4)
      expect(sessionStorage.getItem('volume')).toBe('0.4')
      expect(sessionStorage.getItem('defaultVolume')).toBe('0.4')
      expect(sessionStorage.getItem('muted')).toBe('false')
    })

    it('defaultVolume of 0 marks the player as muted', async () => {
      const { store } = buildStore()

      await store.dispatch('updateDefaultVolume', 0)

      expect(sessionStorage.getItem('muted')).toBe('true')
    })

    it('maxVideoPlaybackRate lowers the default playback rate when it exceeds the new max', async () => {
      const { store } = buildStore({ defaultPlayback: 2.5 })

      await store.dispatch('updateMaxVideoPlaybackRate', 2)
      await flushPromises()

      expect(upsertCalls()).toEqual([['maxVideoPlaybackRate', 2], ['defaultPlayback', 2]])
      expect(store.getters.getDefaultPlayback).toBe(2)
    })

    it('maxVideoPlaybackRate leaves a default playback rate that fits alone', async () => {
      const { store } = buildStore({ defaultPlayback: 1.5 })

      await store.dispatch('updateMaxVideoPlaybackRate', 2)
      await flushPromises()

      expect(upsertCalls()).toEqual([['maxVideoPlaybackRate', 2]])
      expect(store.getters.getDefaultPlayback).toBe(1.5)
    })

    it('videoPlaybackRateInterval snaps the default playback rate to the new step', async () => {
      const { store } = buildStore({ defaultPlayback: 1.1 })

      await store.dispatch('updateVideoPlaybackRateInterval', 0.25)
      await flushPromises()

      expect(upsertCalls()).toContainEqual(['defaultPlayback', 1])
      expect(store.getters.getDefaultPlayback).toBe(1)
    })

    it('videoPlaybackRateInterval does nothing when the rate is already on the step', async () => {
      const { store } = buildStore({ defaultPlayback: 1.5 })

      await store.dispatch('updateVideoPlaybackRateInterval', 0.5)
      await flushPromises()

      expect(upsertCalls()).toEqual([['videoPlaybackRateInterval', 0.5]])
    })

    it('defaultInvidiousInstance switches the current instance when it differs', async () => {
      const { store, setCurrentInvidiousInstance } = buildStore()

      await store.dispatch('updateDefaultInvidiousInstance', 'https://new.example')

      expect(setCurrentInvidiousInstance).toHaveBeenCalledTimes(1)
      expect(store.state.invidious.currentInvidiousInstance).toBe('https://new.example')
    })

    it.each([
      ['empty', ''],
      ['the current instance', 'https://current.example'],
    ])('defaultInvidiousInstance does not switch for %s', async (_, value) => {
      const { store, setCurrentInvidiousInstance } = buildStore()

      await store.dispatch('updateDefaultInvidiousInstance', value)

      expect(setCurrentInvidiousInstance).not.toHaveBeenCalled()
      expect(store.getters.getDefaultInvidiousInstance).toBe(value)
    })

    it('uiScale has no effect outside Electron', async () => {
      const { store } = buildStore()

      await store.dispatch('updateUiScale', 150)

      expect(store.getters.getUiScale).toBe(150)
    })

    describe('currentLocale', () => {
      it('loads and activates an explicit locale and refreshes region data', async () => {
        const { store, getRegionData } = buildStore()

        await store.dispatch('updateCurrentLocale', 'de-DE')
        await flushPromises()

        expect(loadLocale.mock.calls).toEqual([['de-DE']])
        expect(i18n.global.locale.value).toBe('de-DE')
        expect(getRegionData).toHaveBeenCalledTimes(1)
        expect(getRegionData.mock.calls[0][1]).toBe('de-DE')
        expect(store.getters.getCurrentLocale).toBe('de-DE')
      })

      it.each([
        ['es-MX', 'es'],
        ['es-AR', 'es'],
        ['pt-BR', 'pt'],
        ['pt-PT', 'pt'],
      ])('also loads the %s fallback locale %s', async (locale, fallback) => {
        const { store } = buildStore()

        await store.dispatch('updateCurrentLocale', locale)
        await flushPromises()

        expect(loadLocale.mock.calls).toEqual([[fallback], [locale]])
        expect(i18n.global.locale.value).toBe(locale)
      })

      it.each([
        ['an exact match', 'pt_BR', 'pt-BR'],
        ['a language-only locale over country variants', 'pt-AO', 'pt'],
        ['the only locale for the language', 'de-AT', 'de-DE'],
        ['the alphabetically first variant when no exact or language-only match exists', 'en-AU', 'en-GB'],
      ])('"system" resolves to %s', async (_, systemLocale, expected) => {
        getSystemLocale.mockResolvedValue(systemLocale)
        const { store } = buildStore()

        await store.dispatch('updateCurrentLocale', 'system')
        await flushPromises()

        expect(i18n.global.locale.value).toBe(expected)
        expect(showToast).not.toHaveBeenCalled()
        // the setting itself stays "system"
        expect(store.getters.getCurrentLocale).toBe('system')
      })

      it('"system" falls back to en-US with a toast for an unsupported language', async () => {
        getSystemLocale.mockResolvedValue('xx-YY')
        const { store } = buildStore()

        await store.dispatch('updateCurrentLocale', 'system')
        await flushPromises()

        expect(i18n.global.locale.value).toBe('en-US')
        expect(showToast).toHaveBeenCalledWith('Locale not found, defaulting to en-US')
      })
    })
  })

  describe('custom getters', () => {
    it.each([
      [1.2500000001, 1.25],
      [0.1 + 0.2, 0.3],
      [1.005, 1.01],
      [2, 2],
    ])('getDefaultPlayback rounds %d to two decimals (%d)', (raw, expected) => {
      const { store } = buildStore()

      store.commit('setDefaultPlayback', raw)

      expect(store.getters.getDefaultPlayback).toBe(expected)
    })

    it('getChannelsHiddenIdSet accepts legacy strings and objects with a name', () => {
      const { store } = buildStore()
      store.commit('setChannelsHidden', JSON.stringify([
        'UClegacy',
        { name: 'UCobject', preferredName: 'Pretty' },
        { preferredName: 'no name' },
        'UClegacy',
      ]))

      expect([...store.getters.getChannelsHiddenIdSet]).toEqual(['UClegacy', 'UCobject'])
    })

    it('getChannelsHiddenIdSet is empty by default', () => {
      const { store } = buildStore()

      expect(store.getters.getChannelsHiddenIdSet.size).toBe(0)
    })
  })

  describe('grabUserSettings', () => {
    it('applies stored values, ignores unknown ids and does not write back', async () => {
      DBSettingHandlers.find.mockResolvedValue([
        { _id: 'region', value: 'JP' },
        { _id: 'hideWatchedSubs', value: true },
        { _id: 'someRemovedSetting', value: 123 },
      ])
      const { store } = buildStore()

      await store.dispatch('grabUserSettings')
      await flushPromises()

      expect(store.getters.getRegion).toBe('JP')
      expect(store.getters.getHideWatchedSubs).toBe(true)
      expect(store.state.settings).not.toHaveProperty('someRemovedSetting')
      expect(DBSettingHandlers.upsert).not.toHaveBeenCalled()
    })

    it('triggers each side effect once, with the stored value or else the default', async () => {
      DBSettingHandlers.find.mockResolvedValue([
        { _id: 'defaultVolume', value: 0 },
        { _id: 'currentLocale', value: 'fr-FR' },
      ])
      const { store, getRegionData, setCurrentInvidiousInstance } = buildStore()

      await store.dispatch('grabUserSettings')
      await flushPromises()

      expect(store.getters.getDefaultVolume).toBe(0)
      expect(sessionStorage.getItem('muted')).toBe('true')
      expect(loadLocale.mock.calls).toEqual([['fr-FR']])
      expect(getRegionData).toHaveBeenCalledTimes(1)
      expect(i18n.global.locale.value).toBe('fr-FR')
      // not stored: triggered with the default '' which is a no-op
      expect(setCurrentInvidiousInstance).not.toHaveBeenCalled()
    })

    it('applies the default locale ("system") when none is stored', async () => {
      DBSettingHandlers.find.mockResolvedValue([])
      getSystemLocale.mockResolvedValue('it-IT')
      const { store } = buildStore()

      await store.dispatch('grabUserSettings')
      await flushPromises()

      expect(i18n.global.locale.value).toBe('it')
      expect(sessionStorage.getItem('volume')).toBe('1')
    })

    it('logs and keeps defaults when the DB read fails', async () => {
      DBSettingHandlers.find.mockRejectedValue(new Error('db'))
      const { store } = buildStore()

      await store.dispatch('grabUserSettings')

      expect(store.getters.getRegion).toBe('US')
      expect(consoleError).toHaveBeenCalled()
    })
  })

  describe('NON_TRANSFERABLE_SETTINGS', () => {
    it('covers proxy, external player and backend settings', () => {
      for (const id of ['useProxy', 'proxyPassword', 'externalPlayerExecutable', 'backendPreference', 'screenshotFolderPath']) {
        expect(NON_TRANSFERABLE_SETTINGS.has(id)).toBe(true)
      }
      expect(NON_TRANSFERABLE_SETTINGS.has('region')).toBe(false)
    })
  })
})
