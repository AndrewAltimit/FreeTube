import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  SORT_BY_VALUES,
  generateRandomUniqueId,
  getSortedPlaylistItems,
  processToBeAddedPlaylistVideo,
  videoDurationPresent,
  videoDurationWithFallback,
} from '../../../../src/renderer/helpers/playlists.js'

const items = [
  { videoId: 'a', title: 'banana', author: 'Zed', timeAdded: 300, published: 1000, lengthSeconds: 60 },
  { videoId: 'b', title: 'Apple', author: 'amy', timeAdded: 100, published: 3000, lengthSeconds: 600 },
  { videoId: 'c', title: 'cherry', author: 'Bob', timeAdded: 200, published: 2000, lengthSeconds: 5 },
]

const ids = (list) => list.map(item => item.videoId)

describe('getSortedPlaylistItems', () => {
  it.each([
    [SORT_BY_VALUES.DateAddedNewest, ['a', 'c', 'b']],
    [SORT_BY_VALUES.DateAddedOldest, ['b', 'c', 'a']],
    [SORT_BY_VALUES.PublishedNewest, ['b', 'c', 'a']],
    [SORT_BY_VALUES.PublishedOldest, ['a', 'c', 'b']],
    [SORT_BY_VALUES.VideoTitleAscending, ['b', 'a', 'c']],
    [SORT_BY_VALUES.VideoTitleDescending, ['c', 'a', 'b']],
    [SORT_BY_VALUES.AuthorAscending, ['b', 'c', 'a']],
    [SORT_BY_VALUES.AuthorDescending, ['a', 'c', 'b']],
    [SORT_BY_VALUES.VideoDurationAscending, ['c', 'a', 'b']],
    [SORT_BY_VALUES.VideoDurationDescending, ['b', 'a', 'c']],
  ])('sorts by %s', (sortOrder, expected) => {
    expect(ids(getSortedPlaylistItems(items, sortOrder, 'en-US'))).toEqual(expected)
  })

  it('reverses the sort when requested', () => {
    expect(ids(getSortedPlaylistItems(items, SORT_BY_VALUES.DateAddedNewest, 'en-US', true))).toEqual(['b', 'c', 'a'])
    expect(ids(getSortedPlaylistItems(items, SORT_BY_VALUES.VideoTitleAscending, 'en-US', true))).toEqual(['c', 'a', 'b'])
  })

  it('does not mutate the input array', () => {
    const copy = [...items]
    getSortedPlaylistItems(items, SORT_BY_VALUES.VideoTitleAscending, 'en-US')
    getSortedPlaylistItems(items, SORT_BY_VALUES.Custom, 'en-US', true)
    expect(items).toEqual(copy)
  })

  it('returns the same array for custom order', () => {
    expect(getSortedPlaylistItems(items, SORT_BY_VALUES.Custom, 'en-US')).toBe(items)
  })

  it('returns a reversed copy for reversed custom order', () => {
    expect(ids(getSortedPlaylistItems(items, SORT_BY_VALUES.Custom, 'en-US', true))).toEqual(['c', 'b', 'a'])
  })

  it('sorts videos with missing or invalid published dates as oldest', () => {
    const list = [
      { videoId: 'nan', published: NaN },
      { videoId: 'missing' },
      { videoId: 'string', published: '2024-01-01' },
      { videoId: 'valid', published: 5 },
    ]

    const sorted = ids(getSortedPlaylistItems(list, SORT_BY_VALUES.PublishedNewest, 'en-US'))
    expect(sorted[0]).toBe('valid')
    expect(sorted.slice(1).sort()).toEqual(['missing', 'nan', 'string'])
  })

  it('sorts videos with unknown duration as shortest', () => {
    const list = [
      { videoId: 'long', lengthSeconds: 100 },
      { videoId: 'live', lengthSeconds: 'LIVE' },
      { videoId: 'short', lengthSeconds: 1 },
    ]

    expect(ids(getSortedPlaylistItems(list, SORT_BY_VALUES.VideoDurationAscending, 'en-US'))).toEqual(['live', 'short', 'long'])
  })

  it('uses locale-aware collation for titles', () => {
    const list = [
      { videoId: 'z', title: 'z' },
      { videoId: 'ae', title: 'ä' },
      { videoId: 'a', title: 'a' },
    ]

    expect(ids(getSortedPlaylistItems(list, SORT_BY_VALUES.VideoTitleAscending, 'de'))).toEqual(['a', 'ae', 'z'])
    expect(ids(getSortedPlaylistItems(list, SORT_BY_VALUES.VideoTitleAscending, 'sv'))).toEqual(['a', 'z', 'ae'])
  })

  it('logs and keeps order for an unknown sort order', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(ids(getSortedPlaylistItems(items, 'bogus', 'en-US'))).toEqual(['a', 'b', 'c'])
    expect(error).toHaveBeenCalledWith('Unknown sortOrder: bogus')
  })
})

describe('videoDurationPresent / videoDurationWithFallback', () => {
  it.each([
    [{ lengthSeconds: 10 }, true, 10],
    [{ lengthSeconds: 0 }, false, 0],
    [{ lengthSeconds: NaN }, false, 0],
    [{ lengthSeconds: '10' }, false, 0],
    [{ lengthSeconds: '0:00' }, false, 0],
    [{}, false, 0],
  ])('%j', (video, present, fallback) => {
    expect(videoDurationPresent(video)).toBe(present)
    expect(videoDurationWithFallback(video)).toBe(fallback)
  })
})

describe('processToBeAddedPlaylistVideo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fills in missing fields', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-01T00:00:00Z'))

    const video = { videoId: 'abc' }
    processToBeAddedPlaylistVideo(video)

    expect(video.timeAdded).toBe(Date.parse('2025-06-01T00:00:00Z'))
    expect(typeof video.playlistItemId).toBe('string')
    expect(video.playlistItemId.length).toBeGreaterThan(0)
    expect(video.type).toBe('video')
  })

  it('keeps existing fields, including falsy timeAdded of 0', () => {
    const video = { videoId: 'abc', timeAdded: 0, playlistItemId: 'existing', type: 'short' }
    processToBeAddedPlaylistVideo(video)

    expect(video).toEqual({ videoId: 'abc', timeAdded: 0, playlistItemId: 'existing', type: 'short' })
  })
})

describe('generateRandomUniqueId', () => {
  it('generates distinct ids', () => {
    const generated = new Set(Array.from({ length: 50 }, () => generateRandomUniqueId()))
    expect(generated.size).toBe(50)
  })
})
