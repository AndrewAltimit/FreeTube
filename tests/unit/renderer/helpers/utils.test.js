import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as utils from '../../../../src/renderer/helpers/utils.js'
import i18n from '../../../../src/renderer/i18n/index'
import router from '../../../../src/renderer/router/index'
import { UnsupportedPlayerActions } from '../../../../src/constants.js'

vi.mock('../../../../src/renderer/i18n/index', () => ({
  default: {
    global: {
      locale: { value: 'en-US' },
      t: vi.fn((key, params) => (params ? `${key} ${JSON.stringify(params)}` : key)),
    },
  },
}))

vi.mock('../../../../src/renderer/router/index', () => ({
  default: { push: vi.fn() },
}))

const NOW = new Date('2026-06-15T12:00:00Z')
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Temporarily overrides process.platform (a runtime value, unlike the inlined build flags).
 * @param {string} platform
 */
function withPlatform(platform) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  return () => Object.defineProperty(process, 'platform', original)
}

describe('getIconForSortPreference', () => {
  it.each([
    ['name_descending', 'sort-alpha-down-alt'],
    ['video_title_descending', 'sort-alpha-down-alt'],
    ['author_ascending', 'sort-alpha-down'],
    ['newest', 'arrow-down-wide-short'],
    ['custom', 'arrow-down-wide-short'],
    ['oldest', 'arrow-down-short-wide'],
    ['published_ascending', 'arrow-down-short-wide'],
    ['something_unknown', 'arrow-down-short-wide'],
  ])('%s -> %s', (pref, icon) => {
    expect(utils.getIconForSortPreference(pref)).toEqual(['fas', icon])
  })
})

describe('calculatePublishedDate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  it('returns now for live videos, regardless of text', () => {
    expect(utils.calculatePublishedDate('3 years ago', true)).toBe(NOW.getTime())
  })

  it('returns the premiere date for upcoming videos', () => {
    const premiere = new Date('2026-07-01T00:00:00Z')
    expect(utils.calculatePublishedDate('', false, true, premiere)).toBe(premiere.getTime())
  })

  it('returns now for upcoming videos without a premiere date', () => {
    expect(utils.calculatePublishedDate(undefined, false, true)).toBe(NOW.getTime())
  })

  it.each([undefined, null, ''])('returns undefined for missing text %j', (text) => {
    expect(utils.calculatePublishedDate(text)).toBeUndefined()
  })

  it.each([
    ['1 second ago', SECOND],
    ['30 seconds ago', 30 * SECOND],
    ['5s', 5 * SECOND],
    ['1 minute ago', MINUTE],
    ['10 minutes ago', 10 * MINUTE],
    ['7m', 7 * MINUTE],
    ['7 min ago', 7 * MINUTE],
    ['2 hours ago', 2 * HOUR],
    ['3h', 3 * HOUR],
    ['1 day ago', DAY],
    ['4d', 4 * DAY],
    ['2 weeks ago', 14 * DAY],
    ['1w', 7 * DAY],
    ['1 month ago', 30 * DAY],
    ['11 months ago', 330 * DAY],
    ['2mo', 60 * DAY],
    ['1 year ago', 31556952000],
    ['2y', 2 * 31556952000],
    ['Streamed 3 days ago', 3 * DAY],
  ])('%j is %i ms before now', (text, offset) => {
    expect(utils.calculatePublishedDate(text)).toBe(NOW.getTime() - offset)
  })

  it('treats an unrecognised unit as now', () => {
    expect(utils.calculatePublishedDate('5 fortnights ago')).toBe(NOW.getTime())
  })

  it('matches units case-sensitively, so upper-case text is treated as now', () => {
    // PUBLISHED_TEXT_REGEX is case-insensitive but the unit comparisons are not.
    expect(utils.calculatePublishedDate('3 DAYS AGO')).toBe(NOW.getTime())
  })

  it('throws for text without a number', () => {
    expect(() => utils.calculatePublishedDate('Premiered recently')).toThrow(TypeError)
  })
})

describe('buildVTTFileLocally', () => {
  const storyboard = {
    template_url: 'https://i.ytimg.com/sb/id/storyboard_$M.jpg?sigh=x',
    thumbnail_width: 160,
    thumbnail_height: 90,
    thumbnail_count: 5,
    interval: 2000,
    columns: 2,
    rows: 2,
  }

  it('emits one cue per sub-image across all sheets with grid coordinates', () => {
    const vtt = utils.buildVTTFileLocally(storyboard, 10)

    const expected = [
      'WEBVTT',
      '',
      '00:00:00.000 --> 00:00:02.000',
      'https://i.ytimg.com/sb/id/storyboard_0.jpg?sigh=x#xywh=0,0,160,90',
      '',
      '00:00:02.000 --> 00:00:04.000',
      'https://i.ytimg.com/sb/id/storyboard_0.jpg?sigh=x#xywh=160,0,160,90',
      '',
      '00:00:04.000 --> 00:00:06.000',
      'https://i.ytimg.com/sb/id/storyboard_0.jpg?sigh=x#xywh=0,90,160,90',
      '',
      '00:00:06.000 --> 00:00:08.000',
      'https://i.ytimg.com/sb/id/storyboard_0.jpg?sigh=x#xywh=160,90,160,90',
      '',
      '00:00:08.000 --> 00:00:10.000',
      'https://i.ytimg.com/sb/id/storyboard_1.jpg?sigh=x#xywh=0,0,160,90',
      '',
    ]
    // 5 thumbnails on 2x2 sheets -> 2 sheets, every slot of each sheet gets a cue (8 cues)
    expect(vtt.split('\n').slice(0, expected.length)).toEqual(expected)
    expect(vtt.match(/-->/g)).toHaveLength(8)
  })

  it('derives the interval from the video length when interval is 0', () => {
    const vtt = utils.buildVTTFileLocally({ ...storyboard, interval: 0, thumbnail_count: 4 }, 40)

    expect(vtt).toContain('00:00:00.000 --> 00:00:10.000')
    expect(vtt).toContain('00:00:30.000 --> 00:00:40.000')
  })

  it('rolls seconds over into minutes', () => {
    const vtt = utils.buildVTTFileLocally({ ...storyboard, interval: 25000, columns: 1, rows: 4, thumbnail_count: 4 }, 0)

    expect(vtt).toContain('00:00:50.000 --> 00:01:15.000')
    expect(vtt).toContain('00:01:15.000 --> 00:01:40.000')
  })

  // BUG: the rollover only subtracts 60 once per cue (utils.js:146-153), so an
  // interval of 60 s or more (possible when it is derived from a long video's
  // length, or on coarse storyboard levels) produces timestamps like
  // "00:00:1800.000", which are invalid WebVTT.
  it.fails('rolls intervals of a minute or more over into minutes and hours', () => {
    const vtt = utils.buildVTTFileLocally({ ...storyboard, interval: 30 * 60 * 1000, columns: 1, rows: 3, thumbnail_count: 3 }, 0)

    expect(vtt).toContain('00:00:00.000 --> 00:30:00.000')
    expect(vtt).toContain('00:30:00.000 --> 01:00:00.000')
    expect(vtt).toContain('01:00:00.000 --> 01:30:00.000')
  })
})

describe('buildChaptersVttFile', () => {
  it('formats chapters as VTT cues with trimmed titles', () => {
    const vtt = utils.buildChaptersVttFile([
      { startSeconds: 0, endSeconds: 65.5, title: '  Intro ' },
      { startSeconds: 65.5, endSeconds: 3725, title: 'Main part' },
    ])

    expect(vtt).toBe(
      'WEBVTT\n\n' +
      '00:00:00.000 --> 00:01:05.500\nIntro\n\n' +
      '00:01:05.500 --> 01:02:05.000\nMain part\n'
    )
  })

  it('produces just the header for no chapters', () => {
    expect(utils.buildChaptersVttFile([])).toBe('WEBVTT\n')
  })
})

describe('showToast', () => {
  it('dispatches a toast-open event with the details', () => {
    const listener = vi.fn()
    utils.ToastEventBus.addEventListener('toast-open', listener)

    const action = () => {}
    utils.showToast('Hello', 3000, action)

    utils.ToastEventBus.removeEventListener('toast-open', listener)
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0].detail).toEqual({ message: 'Hello', time: 3000, action, abortSignal: null })
  })

  it('does nothing for a time of 0', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const listener = vi.fn()
    utils.ToastEventBus.addEventListener('toast-open', listener)

    utils.showToast('Hello', 0)

    utils.ToastEventBus.removeEventListener('toast-open', listener)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('copyToClipboard', () => {
  let toasts
  const onToast = (e) => toasts.push(e.detail)

  beforeEach(() => {
    toasts = []
    utils.ToastEventBus.addEventListener('toast-open', onToast)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    utils.ToastEventBus.removeEventListener('toast-open', onToast)
    vi.unstubAllGlobals()
  })

  function stubClipboard({ secure = true, writeText = vi.fn(async () => {}) } = {}) {
    vi.stubGlobal('isSecureContext', secure)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  it('writes text and shows the success message', async () => {
    const writeText = stubClipboard()

    await utils.copyToClipboard('abc', { messageOnSuccess: 'Copied' })

    expect(writeText).toHaveBeenCalledWith('abc')
    expect(toasts.map(t => t.message)).toEqual(['Copied'])
  })

  it('shows no toast on success without a message', async () => {
    stubClipboard()

    await utils.copyToClipboard('abc')

    expect(toasts).toEqual([])
  })

  it('shows the custom error message on failure', async () => {
    stubClipboard({ writeText: vi.fn(async () => { throw new Error('denied') }) })

    await utils.copyToClipboard('abc', { messageOnError: 'Nope' })

    expect(toasts).toEqual([expect.objectContaining({ message: 'Nope: Error: denied', time: 5000 })])
  })

  it('shows the default error message on failure', async () => {
    stubClipboard({ writeText: vi.fn(async () => { throw new Error('denied') }) })

    await utils.copyToClipboard('abc')

    expect(toasts[0].message).toBe('Clipboard.Copy failed: Error: denied')
  })

  it('refuses outside a secure context', async () => {
    const writeText = stubClipboard({ secure: false })

    await utils.copyToClipboard('abc')

    expect(writeText).not.toHaveBeenCalled()
    expect(toasts[0].message).toBe('Clipboard.Cannot access clipboard without a secure connection')
  })
})

describe('openExternalLink / openInternalPath', () => {
  it('opens external links in a new tab without a referrer', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)

    await utils.openExternalLink('https://example.com')

    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noreferrer')
  })

  it('pushes to the router outside Electron even when a new window is requested', () => {
    utils.openInternalPath({ path: '/watch/abc', query: { timestamp: '5' }, doCreateNewWindow: true })

    expect(router.push).toHaveBeenCalledWith({ path: '/watch/abc', query: { timestamp: '5' } })
  })
})

describe('createWebURL', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it.each([
    ['/', '/static/img.png', '/static/img.png'],
    ['/', 'static/img.png', '/static/img.png'],
    ['/app/index.html', 'static/img.png', '/app/static/img.png'],
    ['/app/', '/static/img.png', '/app/static/img.png'],
    ['/app', 'x', '/app/x'],
  ])('from %s, %s -> %s', (location, path, expectedPath) => {
    window.history.replaceState(null, '', location)
    expect(utils.createWebURL(path)).toBe(`${window.location.origin}${expectedPath}`)
  })
})

describe('formatDurationAsTimestamp', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [59, '0:59'],
    [60, '1:00'],
    [61, '1:01'],
    [600, '10:00'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3661, '1:01:01'],
    [36000, '10:00:00'],
    [90061, '25:01:01'],
  ])('%i -> %s', (seconds, expected) => {
    expect(utils.formatDurationAsTimestamp(seconds)).toBe(expected)
  })

  it.each(['LIVE', 'UPCOMING', '1:23'])('passes string %j through', (value) => {
    expect(utils.formatDurationAsTimestamp(value)).toBe(value)
  })
})

describe('searchFiltersMatch', () => {
  const filters = { prioritize: 'relevance', time: '', type: 'all', duration: '', features: ['hd', 'subtitles'] }

  it('matches identical filters', () => {
    expect(utils.searchFiltersMatch(filters, { ...filters, features: [...filters.features] })).toBe(true)
  })

  it.each([
    ['prioritize', { prioritize: 'upload_date' }],
    ['time', { time: 'today' }],
    ['type', { type: 'video' }],
    ['duration', { duration: 'short' }],
    ['feature order', { features: ['subtitles', 'hd'] }],
    ['feature count', { features: ['hd'] }],
  ])('does not match when %s differs', (_, change) => {
    expect(utils.searchFiltersMatch(filters, { ...filters, ...change })).toBe(false)
  })

  it('does not match against a missing filter object', () => {
    expect(utils.searchFiltersMatch(filters, null)).toBeFalsy()
  })

  // Both arguments are documented as nullable, but with no features on either side
  // the final `every` short-circuits to `undefined` (utils.js:530), so two
  // equally-empty filter sets are reported as not matching.
  it.fails('matches two missing filter objects', () => {
    expect(utils.searchFiltersMatch(null, null)).toBe(true)
  })
})

describe('replaceFilenameForbiddenChars', () => {
  let restore

  afterEach(() => {
    restore?.()
    restore = undefined
  })

  const name = 'a<b>c:d"e/f\\g|h?i*j'

  it('replaces all Windows-reserved characters with full-width variants', () => {
    restore = withPlatform('win32')
    expect(utils.replaceFilenameForbiddenChars(name)).toBe('a＜b＞c：d＂e／f＼g｜h？i＊j')
  })

  it('replaces / and : on macOS', () => {
    restore = withPlatform('darwin')
    expect(utils.replaceFilenameForbiddenChars(name)).toBe('a<b>c：d"e／f\\g|h?i*j')
  })

  it('replaces only / on Linux', () => {
    restore = withPlatform('linux')
    expect(utils.replaceFilenameForbiddenChars(name)).toBe('a<b>c:d"e／f\\g|h?i*j')
  })

  it('replaces every occurrence', () => {
    restore = withPlatform('linux')
    expect(utils.replaceFilenameForbiddenChars('a/b/c//')).toBe('a／b／c／／')
  })

  it('leaves names alone on other platforms', () => {
    restore = withPlatform('freebsd')
    expect(utils.replaceFilenameForbiddenChars(name)).toBe(name)
  })
})

describe('getSystemLocale', () => {
  it('uses navigator.language in non-Electron builds', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE')
    expect(await utils.getSystemLocale()).toBe('de-DE')
  })

  it('falls back to en-US', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('')
    expect(await utils.getSystemLocale()).toBe('en-US')
  })
})

describe('extractNumberFromString', () => {
  it.each([
    ['1,234,567 views', 1234567],
    ['12.345 Aufrufe', 12345],
    ['abc', NaN],
    ['', NaN],
  ])('%j -> %d', (input, expected) => {
    expect(utils.extractNumberFromString(input)).toBe(expected)
  })

  it.each([123, null, undefined, {}])('returns NaN for non-string %j', (input) => {
    expect(utils.extractNumberFromString(input)).toBeNaN()
  })
})

describe('showExternalPlayerUnsupportedActionToast', () => {
  it('shows a toast naming the player and the localised action', () => {
    const listener = vi.fn()
    utils.ToastEventBus.addEventListener('toast-open', listener)

    utils.showExternalPlayerUnsupportedActionToast('mpv', UnsupportedPlayerActions.PLAYBACK_RATE)

    utils.ToastEventBus.removeEventListener('toast-open', listener)
    expect(i18n.global.t).toHaveBeenCalledWith('Video.External Player.UnsupportedActionTemplate', {
      externalPlayer: 'mpv',
      action: 'Video.External Player.Unsupported Actions.setting a playback rate',
    })
    expect(listener).toHaveBeenCalledOnce()
  })
})

describe('getVideoParamsFromUrl', () => {
  const empty = { videoId: null, timestamp: null, playlistId: null }

  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', { videoId: 'dQw4w9WgXcQ', timestamp: null, playlistId: null }],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQextra', { videoId: 'dQw4w9WgXcQ', timestamp: null, playlistId: null }],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=42', { videoId: 'dQw4w9WgXcQ', timestamp: '42', playlistId: 'PL123' }],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s', { videoId: 'dQw4w9WgXcQ', timestamp: 3723, playlistId: null }],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s', { videoId: 'dQw4w9WgXcQ', timestamp: 90, playlistId: null }],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=2m', { videoId: 'dQw4w9WgXcQ', timestamp: 120, playlistId: null }],
    ['https://youtu.be/dQw4w9WgXcQ?t=10&list=PLx', { videoId: 'dQw4w9WgXcQ', timestamp: '10', playlistId: 'PLx' }],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ?t=5s', { videoId: 'dQw4w9WgXcQ', timestamp: 5, playlistId: null }],
    ['https://www.youtube.com/embed/videoseries?list=PLabc', { videoId: null, timestamp: null, playlistId: 'PLabc' }],
    ['https://www.youtube.com/shorts/abcdefghijk', { videoId: 'abcdefghijk', timestamp: null, playlistId: null }],
    ['https://www.youtube.com/live/abcdefghijk?t=3', { videoId: 'abcdefghijk', timestamp: '3', playlistId: null }],
    ['https://cadence.moe/cloudtube/video/abcdefghijk', { videoId: 'abcdefghijk', timestamp: null, playlistId: null }],
    ['https://invidious.example/watch?v=abcdefghijk', { videoId: 'abcdefghijk', timestamp: null, playlistId: null }],
  ])('%s', (url, expected) => {
    expect(utils.getVideoParamsFromUrl(url)).toEqual(expected)
  })

  it.each([
    'not a url',
    '',
    'https://youtu.be/short',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',
    'https://example.com/cloudtube/video/abcdefghijk',
    'https://www.youtube.com/shorts/abc/def',
  ])('returns empty params for %j', (url) => {
    expect(utils.getVideoParamsFromUrl(url)).toEqual(empty)
  })
})

describe('toDistractionFreeTitle', () => {
  it.each([
    ['THIS IS AMAZING', 'This IS Amazing'],
    ['I made a HUGE mistake', 'I made a Huge mistake'],
    ['Not OK', 'Not OK'],
    ['DON\'T DO THIS', 'Don\'t DO This'],
    ['Wow!!!', 'Wow!'],
    ['What?!?!', 'What?'],
    ['Really???', 'Really?'],
    ['ÜBER COOL', 'Über Cool'],
    ['already normal', 'already normal'],
  ])('%j -> %j', (input, expected) => {
    expect(utils.toDistractionFreeTitle(input)).toBe(expected)
  })

  it('respects minUpperCase', () => {
    expect(utils.toDistractionFreeTitle('Not OK', 2)).toBe('Not Ok')
  })

  // BUG: the character class `[\p{Lu}|']` (utils.js:740) contains a literal `|`,
  // so a run like "|||" (or "'''") matches. capitalizedWord then finds no letter
  // (index -1) and calls `undefined.toUpperCase()`, throwing a TypeError for
  // titles such as "Part 1 ||| Part 2".
  it.fails('does not throw on a run of pipes', () => {
    expect(utils.toDistractionFreeTitle('Part 1 ||| Part 2')).toBe('Part 1 ||| Part 2')
  })
})

describe('formatNumber / formatSubscriberCount', () => {
  it('formats with the current locale', () => {
    expect(utils.formatNumber(1234567)).toBe('1,234,567')
  })

  it.each([
    [999, '999'],
    [1000, '1K'],
    [1234, '1.23K'],
    [1500000, '1.5M'],
    [12345678, '12.3M'],
  ])('subscriber count %i -> %s', (n, expected) => {
    expect(utils.formatSubscriberCount(n)).toBe(expected)
  })
})

describe('isNumberRounded', () => {
  it.each([
    [100, false],
    [1200, true],
    [1234, false],
    [12000, true],
    [12345, false],
    [100000, true],
    [1200000, true],
    [1230000, false],
    [12000000, true],
    [12300000, false],
    [1000000000, true],
    [1100000000, true],
    [1110000000, false],
    [123456789012, false],
  ])('%i -> %s', (n, expected) => {
    expect(utils.isNumberRounded(n)).toBe(expected)
  })
})

describe('getTodayDateStrLocalTimezone', () => {
  it('returns the local calendar date as YYYY-MM-DD', () => {
    vi.useFakeTimers()
    const local = new Date(2026, 0, 31, 23, 30)
    vi.setSystemTime(local)

    expect(utils.getTodayDateStrLocalTimezone()).toBe('2026-01-31')
  })
})

describe('getLocalesWithFallback', () => {
  it('adds en as a fallback', () => {
    expect(utils.getLocalesWithFallback('de')).toEqual(['de', 'en'])
  })

  it('uses only en for locales Chromium cannot format', () => {
    expect(utils.getLocalesWithFallback('az')).toEqual(['en'])
  })
})

describe('getRelativeTimeFromDate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  const ago = (ms) => NOW.getTime() - ms

  it.each([0, undefined, null])('returns an empty string for %j', (date) => {
    expect(utils.getRelativeTimeFromDate(date)).toBe('')
  })

  it.each([
    [30 * SECOND, '30 seconds ago'],
    [MINUTE, '1 minute ago'],
    [90 * SECOND, '1 minute ago'],
    [59 * MINUTE, '59 minutes ago'],
    [HOUR, '1 hour ago'],
    [23 * HOUR, '23 hours ago'],
    [DAY, '1 day ago'],
    [6 * DAY, '6 days ago'],
    [7 * DAY, '1 week ago'],
    [29 * DAY, '4 weeks ago'],
    [30 * DAY, '1 month ago'],
    [359 * DAY, '11 months ago'],
    [360 * DAY, '1 year ago'],
    [3 * 365 * DAY, '3 years ago'],
  ])('%i ms ago -> %s', (ms, expected) => {
    expect(utils.getRelativeTimeFromDate(ago(ms))).toBe(expected)
  })

  it('uses 31-day months when requested', () => {
    expect(utils.getRelativeTimeFromDate(ago(30 * DAY), false, false)).toBe('4 weeks ago')
    expect(utils.getRelativeTimeFromDate(ago(31 * DAY), false, false)).toBe('1 month ago')
  })

  it('returns "Moments Ago" under a minute when hiding seconds', () => {
    expect(utils.getRelativeTimeFromDate(ago(30 * SECOND), true)).toBe('Moments Ago')
    expect(utils.getRelativeTimeFromDate(ago(2 * MINUTE), true)).toBe('2 minutes ago')
  })

  it('uses the en fallback for az', () => {
    i18n.global.locale.value = 'az'
    try {
      expect(utils.getRelativeTimeFromDate(ago(DAY))).toBe('1 day ago')
    } finally {
      i18n.global.locale.value = 'en-US'
    }
  })
})

describe('escapeHTML', () => {
  it('escapes all HTML-significant characters, ampersand first', () => {
    expect(utils.escapeHTML('<a href="x" title=\'y\'>&amp;</a>'))
      .toBe('&lt;a href=&quot;x&quot; title=&apos;y&apos;&gt;&amp;amp;&lt;/a&gt;')
  })
})

describe('deepCopy', () => {
  it('copies nested structures without sharing references', () => {
    const original = { a: [1, { b: 2 }], c: { d: 'e' } }
    const copy = utils.deepCopy(original)

    expect(copy).toEqual(original)
    expect(copy.a).not.toBe(original.a)
    copy.a[1].b = 3
    expect(original.a[1].b).toBe(2)
  })

  it('drops undefined and functions, and stringifies dates (JSON semantics)', () => {
    const copy = utils.deepCopy({ u: undefined, f: () => {}, d: new Date(0) })
    expect(copy).toEqual({ d: '1970-01-01T00:00:00.000Z' })
  })
})

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes a timeout signal and keeps other init options', async () => {
    const fetchMock = vi.fn(async () => 'response')
    vi.stubGlobal('fetch', fetchMock)
    const init = { method: 'POST' }

    expect(await utils.fetchWithTimeout(1000, 'https://x', init)).toBe('response')
    expect(fetchMock.mock.calls[0][1]).toBe(init)
    expect(init.method).toBe('POST')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('creates an init object when none is given', async () => {
    const fetchMock = vi.fn(async () => 'response')
    vi.stubGlobal('fetch', fetchMock)

    await utils.fetchWithTimeout(1000, 'https://x')

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('rethrows the timeout reason instead of a generic AbortError', async () => {
    vi.stubGlobal('fetch', vi.fn((_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))

    await expect(utils.fetchWithTimeout(10, 'https://x')).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('rethrows other errors unchanged', async () => {
    const error = new TypeError('Failed to fetch')
    vi.stubGlobal('fetch', vi.fn(async () => { throw error }))

    await expect(utils.fetchWithTimeout(1000, 'https://x')).rejects.toBe(error)
  })
})

describe('ctrlFHandler', () => {
  let restore

  afterEach(() => {
    restore?.()
    restore = undefined
  })

  it('focuses the input on Ctrl+F outside macOS', async () => {
    restore = withPlatform('linux')
    const input = { focus: vi.fn() }

    utils.ctrlFHandler({ key: 'f', ctrlKey: true, metaKey: false }, input)
    await Promise.resolve()

    expect(input.focus).toHaveBeenCalledOnce()
  })

  it('uses Cmd instead of Ctrl on macOS', async () => {
    restore = withPlatform('darwin')
    const input = { focus: vi.fn() }

    utils.ctrlFHandler({ key: 'F', ctrlKey: true, metaKey: false }, input)
    await Promise.resolve()
    expect(input.focus).not.toHaveBeenCalled()

    utils.ctrlFHandler({ key: 'F', ctrlKey: false, metaKey: true }, input)
    await Promise.resolve()
    expect(input.focus).toHaveBeenCalledOnce()
  })

  it('ignores other keys and a missing input', async () => {
    restore = withPlatform('linux')
    const input = { focus: vi.fn() }

    utils.ctrlFHandler({ key: 'g', ctrlKey: true }, input)
    expect(() => utils.ctrlFHandler({ key: 'f', ctrlKey: true }, null)).not.toThrow()
    await Promise.resolve()

    expect(input.focus).not.toHaveBeenCalled()
  })
})

describe('array helpers', () => {
  it('randomArrayItem returns an element chosen by Math.random', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(utils.randomArrayItem(['a', 'b', 'c', 'd'])).toBe('c')
  })

  it('randomArrayItem returns undefined for an empty array', () => {
    expect(utils.randomArrayItem([])).toBeUndefined()
  })

  it('removeFromArrayIfExists removes only the first match, in place', () => {
    const array = ['a', 'b', 'a']
    utils.removeFromArrayIfExists(array, 'a')
    expect(array).toEqual(['b', 'a'])
  })

  it('removeFromArrayIfExists leaves the array alone when absent', () => {
    const array = ['a']
    utils.removeFromArrayIfExists(array, 'z')
    expect(array).toEqual(['a'])
  })
})

describe('base64EncodeUtf8', () => {
  it.each([
    ['', ''],
    ['hello', 'aGVsbG8='],
    ['héllo', 'aMOpbGxv'],
    ['日本', '5pel5pys'],
    ['😀', '8J+YgA=='],
  ])('%j -> %s', (input, expected) => {
    expect(utils.base64EncodeUtf8(input)).toBe(expected)
  })
})

describe('getChannelPlaylistId', () => {
  const id = 'UCabcdefghijklmnopqrstuv'

  it.each([
    ['videos', 'newest', 'UULFabcdefghijklmnopqrstuv'],
    ['videos', 'popular', 'UULPabcdefghijklmnopqrstuv'],
    ['live', 'newest', 'UULVabcdefghijklmnopqrstuv'],
    ['live', 'popular', 'UUPVabcdefghijklmnopqrstuv'],
    ['shorts', 'newest', 'UUSHabcdefghijklmnopqrstuv'],
    ['shorts', 'popular', 'UUPSabcdefghijklmnopqrstuv'],
    ['all', undefined, 'UUabcdefghijklmnopqrstuv'],
  ])('%s / %s -> %s', (type, sortBy, expected) => {
    expect(utils.getChannelPlaylistId(id, type, sortBy)).toBe(expected)
  })

  it('only replaces a leading UC', () => {
    expect(utils.getChannelPlaylistId('UCxxUCxxxxxxxxxxxxxxxxxx', 'all')).toBe('UUxxUCxxxxxxxxxxxxxxxxxx')
  })

  it('returns undefined for an unknown type', () => {
    expect(utils.getChannelPlaylistId(id, 'podcasts')).toBeUndefined()
  })
})

describe('keyboard shortcut labels', () => {
  let restore

  afterEach(() => {
    restore?.()
    restore = undefined
  })

  it('localises each key and joins them outside macOS', () => {
    restore = withPlatform('win32')
    expect(utils.getLocalizedShortcut('ctrl+shift+f')).toBe('Keys.ctrlshortcutJoinOperatorKeys.shiftshortcutJoinOperatorf')
  })

  it('uses symbols on macOS', () => {
    restore = withPlatform('darwin')
    expect(utils.getLocalizedShortcut('ctrl+shift+arrowleft')).toBe('⌘⇧←')
    expect(utils.getLocalizedShortcut('alt+enter')).toBe('⌥⌤')
  })

  it('builds an action title with several shortcuts', () => {
    restore = withPlatform('darwin')
    const result = utils.localizeAndAddKeyboardShortcutToActionTitle('Play', ['k', 'shift+plus'])

    expect(result).toBe(`KeyboardShortcutTemplate ${JSON.stringify({ label: 'Play', shortcut: 'kshortcutLabelSeparator⇧+' })}`)
  })

  it('accepts a single shortcut string', () => {
    restore = withPlatform('darwin')
    const result = utils.localizeAndAddKeyboardShortcutToActionTitle('Play', 'k')

    expect(result).toBe(`KeyboardShortcutTemplate ${JSON.stringify({ label: 'Play', shortcut: 'k' })}`)
  })
})

describe('debounce', () => {
  it('calls once after the wait with the last arguments and this', () => {
    vi.useFakeTimers()
    const fn = vi.fn(function () { return this })
    const debounced = utils.debounce(fn, 100)
    const context = { debounced }

    context.debounced(1)
    vi.advanceTimersByTime(50)
    context.debounced(2)
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledExactlyOnceWith(2)
    expect(fn.mock.contexts[0]).toBe(context)
  })
})

describe('throttle', () => {
  it('calls immediately, then ignores calls until the wait passes', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const throttled = utils.throttle(fn, 100)

    throttled(1)
    throttled(2)
    vi.advanceTimersByTime(99)
    throttled(3)
    expect(fn.mock.calls).toEqual([[1]])

    vi.advanceTimersByTime(1)
    throttled(4)
    expect(fn.mock.calls).toEqual([[1], [4]])
  })
})
