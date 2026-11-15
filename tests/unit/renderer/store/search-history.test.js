import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestStore } from './helpers/create-test-store.js'
import { DBSearchHistoryHandlers } from '../../../../src/datastores/handlers/index.js'
import searchHistory from '../../../../src/renderer/store/modules/search-history.js'
import {
  MIXED_SEARCH_HISTORY_ENTRIES_DISPLAY_LIMIT,
  SEARCH_RESULTS_DISPLAY_LIMIT,
} from '../../../../src/constants.js'

vi.mock('../../../../src/datastores/handlers/index.js', async () =>
  (await import('./helpers/db-handlers-mock.js')).createDBHandlersMock())

const entry = (_id, lastUpdatedAt = 0) => ({ _id, lastUpdatedAt })

function buildStore(entries = []) {
  return createTestStore({
    modules: { searchHistory },
    state: { searchHistory: { searchHistoryEntries: entries } },
  })
}

const entryIds = (store) => store.getters.getSearchHistoryEntries.map((e) => e._id)

let consoleError

beforeEach(() => {
  vi.resetAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('search-history store module', () => {
  describe('getters', () => {
    it('getLatestSearchHistoryNames returns ids of the most recent entries up to the display limit', () => {
      const entries = Array.from({ length: SEARCH_RESULTS_DISPLAY_LIMIT + 3 }, (_, i) => entry(`q${i}`))
      const store = buildStore(entries)

      const names = store.getters.getLatestSearchHistoryNames
      expect(names).toHaveLength(SEARCH_RESULTS_DISPLAY_LIMIT)
      expect(names[0]).toBe('q0')
    })

    it('getLatestMatchingSearchHistoryNames is a case-sensitive prefix match, shortest first', () => {
      const store = buildStore([entry('vue router'), entry('vuex'), entry('Vue'), entry('react'), entry('vue')])

      expect(store.getters.getLatestMatchingSearchHistoryNames('vue'))
        .toEqual(['vue', 'vuex', 'vue router'])
    })

    it('getLatestMatchingSearchHistoryNames takes only the most recent matches before sorting', () => {
      const limit = MIXED_SEARCH_HISTORY_ENTRIES_DISPLAY_LIMIT
      const longRecent = Array.from({ length: limit }, (_, i) => entry(`a long recent query ${i}`))
      const store = buildStore([...longRecent, entry('a')])

      const result = store.getters.getLatestMatchingSearchHistoryNames('a')
      expect(result).toHaveLength(limit)
      // the short but older 'a' is past the limit, so it is not included
      expect(result).not.toContain('a')
    })

    it('getSearchHistoryEntryWithId finds an entry or returns undefined', () => {
      const store = buildStore([entry('x', 5)])

      expect(store.getters.getSearchHistoryEntryWithId('x')).toEqual(entry('x', 5))
      expect(store.getters.getSearchHistoryEntryWithId('y')).toBeUndefined()
    })
  })

  describe('actions', () => {
    it('grabSearchHistoryEntries loads entries as returned by the DB', async () => {
      DBSearchHistoryHandlers.find.mockResolvedValue([entry('b', 2), entry('a', 1)])
      const store = buildStore()

      await store.dispatch('grabSearchHistoryEntries')

      expect(entryIds(store)).toEqual(['b', 'a'])
    })

    it('grabSearchHistoryEntries keeps state when the DB read fails', async () => {
      DBSearchHistoryHandlers.find.mockRejectedValue(new Error('db'))
      const store = buildStore([entry('a')])

      await store.dispatch('grabSearchHistoryEntries')

      expect(entryIds(store)).toEqual(['a'])
      expect(consoleError).toHaveBeenCalled()
    })

    it('updateSearchHistoryEntry persists a new query at the top', async () => {
      const store = buildStore([entry('a', 1)])
      const updated = entry('b', 2)

      await store.dispatch('updateSearchHistoryEntry', updated)

      expect(DBSearchHistoryHandlers.upsert).toHaveBeenCalledWith(updated)
      expect(entryIds(store)).toEqual(['b', 'a'])
    })

    it('updateSearchHistoryEntry moves a repeated query to the top without duplicating it', async () => {
      const store = buildStore([entry('a', 3), entry('b', 2), entry('c', 1)])

      await store.dispatch('updateSearchHistoryEntry', entry('c', 4))

      expect(entryIds(store)).toEqual(['c', 'a', 'b'])
      expect(store.getters.getSearchHistoryEntryWithId('c').lastUpdatedAt).toBe(4)
    })

    it('updateSearchHistoryEntry leaves state alone when the DB write fails', async () => {
      const store = buildStore([entry('a')])
      DBSearchHistoryHandlers.upsert.mockRejectedValue(new Error('db'))

      await store.dispatch('updateSearchHistoryEntry', entry('b'))

      expect(entryIds(store)).toEqual(['a'])
    })

    it('overwriteSearchHistory saves and replaces the whole list', async () => {
      const store = buildStore([entry('old')])
      const items = [entry('a', 2), entry('b', 1)]

      await store.dispatch('overwriteSearchHistory', items)

      expect(DBSearchHistoryHandlers.overwrite).toHaveBeenCalledTimes(1)
      expect(entryIds(store).sort()).toEqual(['a', 'b'])
    })

    // Regression: `overwriteSearchHistory` used to sort by `timeWatched`
    // (copied from history.js), but search history entries have
    // `lastUpdatedAt`, so the list was saved in import order.
    it('overwriteSearchHistory sorts entries newest first before saving', async () => {
      const store = buildStore()

      await store.dispatch('overwriteSearchHistory', [entry('old', 1), entry('new', 3), entry('mid', 2)])

      const saved = DBSearchHistoryHandlers.overwrite.mock.calls[0][0]
      expect(saved.map((e) => e._id)).toEqual(['new', 'mid', 'old'])
      expect(entryIds(store)).toEqual(['new', 'mid', 'old'])
    })

    it('removeSearchHistoryEntry deletes one query from the DB and the list', async () => {
      const store = buildStore([entry('a'), entry('b'), entry('c')])

      await store.dispatch('removeSearchHistoryEntry', 'b')

      expect(DBSearchHistoryHandlers.delete).toHaveBeenCalledWith('b')
      expect(entryIds(store)).toEqual(['a', 'c'])
    })

    it('removeAllSearchHistoryEntries clears the DB and the list', async () => {
      const store = buildStore([entry('a'), entry('b')])

      await store.dispatch('removeAllSearchHistoryEntries')

      expect(DBSearchHistoryHandlers.deleteAll).toHaveBeenCalledTimes(1)
      expect(store.getters.getSearchHistoryEntries).toEqual([])
    })

    it('removeAllSearchHistoryEntries keeps the list when the DB delete fails', async () => {
      const store = buildStore([entry('a')])
      DBSearchHistoryHandlers.deleteAll.mockRejectedValue(new Error('db'))

      await store.dispatch('removeAllSearchHistoryEntries')

      expect(entryIds(store)).toEqual(['a'])
    })
  })
})
