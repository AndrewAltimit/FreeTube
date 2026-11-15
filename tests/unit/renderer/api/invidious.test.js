import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ADAPTIVE_AUDIO,
  ADAPTIVE_VIDEO,
  INSTANCE,
  LEGACY_FORMAT,
  invidiousComment,
  invidiousCommunityPost,
  invidiousVideo,
} from './fixtures/invidious.js'

const storeGetters = vi.hoisted(() => ({
  getCurrentInvidiousInstanceUrl: 'https://invidious.example',
  getCurrentInvidiousInstanceAuthorization: null,
  getProxyVideos: false,
}))

vi.mock('../../../../src/renderer/store/index.js', () => ({ default: { getters: storeGetters } }))
vi.mock('../../../../src/renderer/router/index.js', () => ({ default: {} }))
vi.mock('../../../../src/renderer/i18n/index.js', () => ({
  default: { global: { t: (key) => key, locale: { value: 'en-US' } } },
}))

const invidious = await import('../../../../src/renderer/helpers/api/invidious.js')

const NOW = new Date('2026-01-15T12:00:00Z').getTime()

/** Routes fetch calls by API path; returns the recorded URLs */
function mockApi(routes) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const parsed = new URL(url)
    calls.push({ url: parsed, init })
    const path = parsed.pathname.replace('/api/v1/', '')
    const route = Object.keys(routes).find(key => path === key || path === `${key}/`)
    if (!route) {
      throw new Error(`unexpected request ${url}`)
    }
    const body = typeof routes[route] === 'function' ? routes[route](parsed) : routes[route]
    return { json: async () => structuredClone(body) }
  }))
  return calls
}

beforeEach(() => {
  storeGetters.getCurrentInvidiousInstanceUrl = INSTANCE
  storeGetters.getCurrentInvidiousInstanceAuthorization = null
  storeGetters.getProxyVideos = false
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('image URL rewriting', () => {
  it.each([
    ['https://yt3.ggpht.com/abc=s88', `${INSTANCE}/ggpht/abc=s88`],
    ['//yt3.ggpht.com/abc=s88', `${INSTANCE}/ggpht/abc=s88`],
    ['https://yt3.googleusercontent.com/xyz', `${INSTANCE}/ggpht/xyz`],
    ['https://i9.ytimg.com/vi/id/hq.jpg', `${INSTANCE}/ggpht/vi/id/hq.jpg`],
    ['https://i.ytimg.com/vi/id/hq.jpg', `${INSTANCE}/ggpht/vi/id/hq.jpg`],
    ['https://example.com/other.png', 'https://example.com/other.png'],
  ])('youtubeImageUrlToInvidious(%s)', (input, expected) => {
    expect(invidious.youtubeImageUrlToInvidious(input)).toBe(expected)
  })

  it('returns an empty string for missing URLs and honours an explicit instance', () => {
    expect(invidious.youtubeImageUrlToInvidious(undefined)).toBe('')
    expect(invidious.youtubeImageUrlToInvidious('https://yt3.ggpht.com/a', 'https://other')).toBe('https://other/ggpht/a')
  })

  it('invidiousImageUrlToInvidious makes relative /ggpht/ paths absolute', () => {
    expect(invidious.invidiousImageUrlToInvidious('<img src="/ggpht/a"><img src="/ggpht/b">', INSTANCE))
      .toBe(`<img src="${INSTANCE}/ggpht/a"><img src="${INSTANCE}/ggpht/b">`)
    expect(invidious.invidiousImageUrlToInvidious(null, INSTANCE)).toBe('')
  })
})

describe('getProxyUrl', () => {
  it('rewrites the origin to the instance and records the original host', () => {
    expect(invidious.getProxyUrl('https://rr1.googlevideo.com/videoplayback?itag=18'))
      .toBe(`${INSTANCE}/videoplayback?itag=18&host=rr1.googlevideo.com`)
  })

  it('keeps an existing host parameter', () => {
    expect(invidious.getProxyUrl('https://rr1.googlevideo.com/videoplayback?host=keep.example'))
      .toBe(`${INSTANCE}/videoplayback?host=keep.example`)
  })

  it('does not add a host when the URL is already on the instance', () => {
    expect(invidious.getProxyUrl(`${INSTANCE}/latest_version?id=x`)).toBe(`${INSTANCE}/latest_version?id=x`)
  })
})

describe('invidiousFetch', () => {
  it('sends the instance authorization header when configured', async () => {
    const calls = mockApi({ stats: {} })
    storeGetters.getCurrentInvidiousInstanceAuthorization = 'Basic abc'
    await invidious.invidiousFetch(`${INSTANCE}/api/v1/stats`)
    expect(calls[0].init).toEqual({ headers: { Authorization: 'Basic abc' } })
  })

  it('sends no options without authorization', async () => {
    const calls = mockApi({ stats: {} })
    await invidious.invidiousFetch(`${INSTANCE}/api/v1/stats`)
    expect(calls[0].init).toBeUndefined()
  })
})

describe('format conversion', () => {
  it('mapInvidiousLegacyFormat splits the size and parses the bitrate', () => {
    expect(invidious.mapInvidiousLegacyFormat(LEGACY_FORMAT)).toEqual({
      itag: '18',
      qualityLabel: '360p',
      fps: 30,
      bitrate: 503000,
      mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
      width: 640,
      height: 360,
      url: LEGACY_FORMAT.url,
    })
  })

  it('convertInvidiousToLocalFormat maps an audio format and reads its xtags', () => {
    const format = invidious.convertInvidiousToLocalFormat(ADAPTIVE_AUDIO)

    expect(format.has_audio).toBe(true)
    expect(format.has_video).toBe(false)
    expect(format.mime_type).toBe(ADAPTIVE_AUDIO.type)
    expect(format.init_range).toEqual({ start: 0, end: 258 })
    expect(format.index_range).toEqual({ start: 259, end: 900 })
    // `dur` seconds -> ms
    expect(format.approx_duration_ms).toBe(212061)
    expect(format.audio_sample_rate).toBe(48000)
    expect(format.language).toBe('de')
    expect(format.is_dubbed).toBe(true)
    expect(format.is_original).toBe(false)
    expect(format.is_drc).toBe(false)
  })

  it('treats audio without an acont xtag as original, unless it is DRC', () => {
    const plain = invidious.convertInvidiousToLocalFormat({ ...ADAPTIVE_AUDIO, url: 'https://x/videoplayback?dur=1&xtags=lang%3Den' })
    expect(plain.is_original).toBe(true)
    expect(plain.language).toBe('en')

    const drc = invidious.convertInvidiousToLocalFormat({ ...ADAPTIVE_AUDIO, url: 'https://x/videoplayback?dur=1&xtags=drc%3D1%3Alang%3Den' })
    expect(drc.is_drc).toBe(true)
    expect(drc.is_original).toBe(false)
  })

  it('convertInvidiousToLocalFormat maps a video format with optional color info', () => {
    const format = invidious.convertInvidiousToLocalFormat({
      ...ADAPTIVE_VIDEO,
      colorInfo: { primaries: 'COLOR_PRIMARIES_BT2020', transferCharacteristics: 'COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084' },
    })

    expect(format.has_video).toBe(true)
    expect(format.has_audio).toBe(false)
    expect(format.quality_label).toBe('720p')
    expect(format.fps).toBe(30)
    expect([format.width, format.height]).toEqual([1280, 720])
    expect(format.color_info).toMatchObject({ primaries: 'BT2020', transfer_characteristics: 'SMPTEST2084' })
    expect(format.language).toBeUndefined()
  })
})

describe('API error handling', () => {
  it('rejects with the Invidious error message and logs it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApi({ 'videos/xyz': { error: 'Video unavailable' } })
    await expect(invidious.invidiousGetVideoInformation('xyz')).rejects.toThrow('Video unavailable')
    expect(log).toHaveBeenCalled()
  })

  it('treats "This channel hasn\'t posted yet" as an empty community tab', async () => {
    mockApi({ 'channels/UCx/community': { error: 'This channel hasn\'t posted yet' } })
    expect(await invidious.invidiousGetCommunityPosts('UCx')).toEqual({ posts: [], continuation: null })
  })

  it('invidiousGetChannelId returns null for non-channel pages and failures', async () => {
    mockApi({ resolveurl: (url) => url.searchParams.get('url').includes('/@good') ? { pageType: 'WEB_PAGE_TYPE_CHANNEL', ucid: 'UCgood' } : { pageType: 'WEB_PAGE_TYPE_WATCH' } })
    expect(await invidious.invidiousGetChannelId('https://www.youtube.com/@good')).toBe('UCgood')
    expect(await invidious.invidiousGetChannelId('https://www.youtube.com/watch?v=x')).toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await invidious.invidiousGetChannelId('https://www.youtube.com/@good')).toBeNull()
  })
})

describe('channel parsing', () => {
  it('renames the streams and posts tabs to FreeTube names', async () => {
    mockApi({ 'channels/UCx': { author: 'X', tabs: ['videos', 'streams', 'posts', 'playlists'] } })
    const info = await invidious.invidiousGetChannelInfo('UCx')
    expect(info.tabs).toEqual(['videos', 'live', 'community', 'playlists'])
  })

  it('converts published seconds to ms and fills an empty authorId with the channel id', async () => {
    const calls = mockApi({
      'channels/UCx/videos': { continuation: 'next', videos: [invidiousVideo({ authorId: '' }), invidiousVideo({ videoId: 'b' })] },
    })

    const result = await invidious.getInvidiousChannelVideos('UCx', 'newest', 'tok')

    expect(calls[0].url.searchParams.get('sort_by')).toBe('newest')
    expect(calls[0].url.searchParams.get('continuation')).toBe('tok')
    expect(result.continuation).toBe('next')
    expect(result.videos[0].authorId).toBe('UCx')
    expect(result.videos[1].authorId).toBe('UCchannel000000000000000')
    expect(result.videos.map(v => v.published)).toEqual([1700000000000, 1700000000000])
  })

  it('sets live videos to "now" and upcoming videos to their premiere time', async () => {
    mockApi({
      'channels/UCx/streams': {
        videos: [
          invidiousVideo({ liveNow: true }),
          invidiousVideo({ isUpcoming: true, premiereTimestamp: 1800000000 }),
        ],
      },
    })

    const { videos } = await invidious.getInvidiousChannelLive('UCx')
    expect(videos[0].published).toBe(NOW)
    expect(videos[1].published).toBe(1800000000000)
  })

  it('strips the unreliable publish/premiere info from shorts', async () => {
    mockApi({ 'channels/UCx/shorts': { videos: [invidiousVideo({ isUpcoming: true, premiereTimestamp: 1 })] } })
    const { videos } = await invidious.getInvidiousChannelShorts('UCx')
    expect(videos[0].isUpcoming).toBe(false)
    expect(videos[0]).not.toHaveProperty('published')
    expect(videos[0]).not.toHaveProperty('premiereTimestamp')
  })

  it.each([
    ['getInvidiousChannelReleases', 'releases', 'isAlbum'],
    ['getInvidiousChannelPodcasts', 'podcasts', 'isPodcast'],
    ['getInvidiousChannelCourses', 'courses', 'isCourse'],
    ['getInvidiousChannelShows', 'shows', 'isShow'],
  ])('%s flags every playlist with %s', async (fn, tab, flag) => {
    mockApi({ [`channels/UCx/${tab}`]: { playlists: [{ title: 'a' }, { title: 'b' }] } })
    const { playlists } = await invidious[fn]('UCx')
    expect(playlists.every(p => p[flag] === true)).toBe(true)
  })

  it('searchInvidiousChannel normalizes only video results', async () => {
    mockApi({
      'channels/UCx/search': [
        invidiousVideo({ authorId: '' }),
        { type: 'playlist', title: 'P', playlistId: 'PL1', published: 5 },
      ],
    })
    const [video, playlist] = await invidious.searchInvidiousChannel('UCx', 'q', 1)
    expect(video.authorId).toBe('UCx')
    expect(video.published).toBe(1700000000000)
    expect(playlist.published).toBe(5)
  })
})

describe('playlist parsing', () => {
  it('offsets the requested index by 50 and computes the next index', async () => {
    const calls = mockApi({
      'playlists/PL1': { videoCount: 5, videos: [invidiousVideo({ videoId: 'a' }), invidiousVideo({ videoId: 'b' })] },
    })

    const { nextIndex, playlist } = await invidious.invidiousGetPlaylistInfo('PL1', 2)

    expect(calls[0].url.searchParams.get('index')).toBe('52')
    expect(nextIndex).toBe(4)
    expect(playlist.videos.map(v => v.published)).toEqual([1700000000000, 1700000000000])
  })

  it('filters deleted/private videos but still counts them for paging', async () => {
    mockApi({
      'playlists/PL1': {
        videoCount: 3,
        videos: [
          invidiousVideo({ videoId: 'a' }),
          invidiousVideo({ videoId: 'deleted', title: '' }),
          invidiousVideo({ videoId: 'private', author: '' }),
          invidiousVideo({ videoId: 'noauthor', authorId: null }),
        ],
      },
    })

    const { nextIndex, playlist } = await invidious.invidiousGetPlaylistInfo('PL1')
    expect(playlist.videos.map(v => v.videoId)).toEqual(['a'])
    expect(nextIndex).toBe(-1)
  })

  it('fetchAllInvidiousPlaylistVideos pages until the end', async () => {
    const pages = {
      50: { videoCount: 3, videos: [invidiousVideo({ videoId: 'a' }), invidiousVideo({ videoId: 'b' })] },
      52: { videoCount: 3, videos: [invidiousVideo({ videoId: 'c' })] },
    }
    mockApi({ 'playlists/PL1': (url) => pages[url.searchParams.get('index')] })

    const videos = await invidious.fetchAllInvidiousPlaylistVideos('PL1')
    expect(videos.map(v => v.videoId)).toEqual(['a', 'b', 'c'])
  })

  it('stops paging when Invidious returns no videos', async () => {
    mockApi({ 'playlists/PL1': { videoCount: 100, videos: [] } })
    const { nextIndex } = await invidious.invidiousGetPlaylistInfo('PL1')
    expect(nextIndex).toBe(-1)
  })
})

describe('search and feeds', () => {
  const settings = { prioritize: 'popularity', time: 'week', duration: 'over_twenty_mins', type: 'all', features: ['hd', 'subtitles'] }

  it('maps search settings to Invidious params and keeps supported result types', async () => {
    const calls = mockApi({
      search: [
        invidiousVideo({ authorId: '' }),
        { type: 'channel', author: 'C' },
        { type: 'playlist', title: 'P' },
        { type: 'hashtag', title: '#tag' },
        { type: 'category', title: 'unsupported' },
      ],
    })

    const result = await invidious.getInvidiousSearchResults('cats', 2, settings)
    const params = calls[0].url.searchParams

    expect(params.get('sort_by')).toBe('view_count')
    expect(params.get('duration')).toBe('long')
    expect(params.get('date')).toBe('week')
    expect(params.get('features')).toBe('hd,subtitles')
    expect(params.get('page')).toBe('2')

    expect(result.rawResultsCount).toBe(5)
    expect(result.validResultsCount).toBe(4)
    expect(result.results.map(r => r.type)).toEqual(['video', 'channel', 'playlist', 'hashtag'])
    // no fallback channel id in global search
    expect(result.results[0].authorId).toBeNull()
    expect(result.results[0].published).toBe(1700000000000)
  })

  // Suspected bug: getInvidiousSearchResults has a `!results` guard (invidious.js:655),
  // but invidiousAPICall reads `json.error` first (invidious.js:60), so a `null` body
  // rejects with a TypeError and the guard is unreachable.
  it.fails('returns an empty result shape for a null response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApi({ search: null })
    expect(await invidious.getInvidiousSearchResults('x', 1, { ...settings, prioritize: 'relevance', duration: '' }))
      .toEqual({ results: null, validResultsCount: 0, rawResultsCount: 0 })
  })

  it('popular feed keeps videos, shorts, channels and playlists', async () => {
    mockApi({
      popular: [
        invidiousVideo(),
        invidiousVideo({ type: 'shortVideo', videoId: 's' }),
        { type: 'channel' },
        { type: 'playlist' },
        { type: 'category' },
      ],
    })
    const items = await invidious.getInvidiousPopularFeed()
    expect(items.map(i => i.type)).toEqual(['video', 'shortVideo', 'channel', 'playlist'])
    expect(items[1].published).toBe(1700000000000)
  })

  it('hashtag results are normalized', async () => {
    mockApi({ 'hashtag/cats': { results: [invidiousVideo({ liveNow: true })] } })
    const [video] = await invidious.getHashtagInvidious('cats')
    expect(video.published).toBe(NOW)
  })
})

describe('comments', () => {
  it('normalizes comments into FreeTube\'s comment shape', async () => {
    const calls = mockApi({
      'comments/vid': {
        continuation: 'more',
        comments: [
          invidiousComment({
            isPinned: true,
            authorIsChannelOwner: true,
            creatorHeart: { creatorThumbnail: '', creatorName: '' },
            isSponsor: true,
            sponsorIconUrl: 'https://yt3.ggpht.com/badge',
            replies: { replyCount: 3, continuation: 'replyTok' },
          }),
          invidiousComment({ commentId: 'second' }),
        ],
      },
    })

    const { commentData } = await invidious.invidiousGetComments({ id: 'vid', sortNewest: false })
    expect(calls[0].url.searchParams.get('sort_by')).toBe('top')

    expect(commentData[0]).toMatchObject({
      id: 'Ugcomment',
      dataType: 'invidious',
      authorThumb: `${INSTANCE}/ggpht/abc=s48`,
      likes: 5,
      isOwner: true,
      isPinned: true,
      isHearted: true,
      isMember: true,
      memberIconUrl: `${INSTANCE}/ggpht/badge`,
      numReplies: 3,
      hasReplyToken: true,
      replyToken: 'replyTok',
      replyLevel: 0,
      hasOwnerReplied: false,
      time: '2 years ago',
    })
    // relative emoji URLs are made absolute and plain URLs are linkified
    expect(commentData[0].text).toContain(`src="${INSTANCE}/ggpht/emoji.png"`)
    expect(commentData[0].text).toContain('<a href="https://example.com"')

    expect(commentData[1]).toMatchObject({ isHearted: false, numReplies: 0, hasReplyToken: false, replyToken: '', memberIconUrl: '' })
  })

  it('returns reply continuations', async () => {
    mockApi({ 'comments/vid': { comments: [invidiousComment()] } })
    const { continuation, commentData } = await invidious.invidiousGetCommentReplies({ id: 'vid', replyToken: 'r' })
    expect(continuation).toBeNull()
    expect(commentData).toHaveLength(1)
  })
})

describe('community posts', () => {
  async function parsePost(attachment, overrides = {}) {
    mockApi({ 'channels/UCx/community': { comments: [invidiousCommunityPost({ attachment, ...overrides })], continuation: 'c' } })
    const { posts, continuation } = await invidious.invidiousGetCommunityPosts('UCx')
    expect(continuation).toBe('c')
    return posts[0]
  }

  it('maps the post fields and rewrites internal links to the router', async () => {
    const post = await parsePost(null)
    expect(post).toMatchObject({
      postId: 'UgkxPost',
      postText: 'Hello <a href="#/watch?v=aaaaaaaaaaa">link</a>',
      voteCount: 10,
      commentCount: 4,
      author: 'Some Channel',
      authorId: 'UCchannel000000000000000',
      postContent: null,
      type: 'community',
      publishedTime: NOW - 3 * 86400000,
    })
    expect(post.authorThumbnails[0].url).toBe(`${INSTANCE}/ggpht/avatar=s88`)
  })

  it('defaults the comment count to 0 on instances without replyCount', async () => {
    const post = await parsePost(null, { replyCount: undefined })
    expect(post.commentCount).toBe(0)
  })

  it('parses image, multi-image and video attachments', async () => {
    const image = await parsePost({ type: 'image', imageThumbnails: [{ url: 'https://yt3.ggpht.com/i', width: 1, height: 1 }] })
    expect(image.postContent).toEqual({ type: 'image', content: [{ url: `${INSTANCE}/ggpht/i`, width: 1, height: 1 }] })

    const multi = await parsePost({ type: 'multiImage', images: [[{ url: 'https://yt3.ggpht.com/a' }], [{ url: 'https://yt3.ggpht.com/b' }]] })
    expect(multi.postContent.content).toEqual([[{ url: `${INSTANCE}/ggpht/a` }], [{ url: `${INSTANCE}/ggpht/b` }]])

    const video = await parsePost({ type: 'video', videoId: 'v', videoThumbnails: [{ url: 'https://i.ytimg.com/vi/v/1.jpg' }] })
    expect(video.postContent.type).toBe('video')
    expect(video.postContent.content.videoThumbnails[0].url).toBe(`${INSTANCE}/ggpht/vi/v/1.jpg`)
  })

  it('parses poll and quiz attachments', async () => {
    const poll = await parsePost({ type: 'poll', choices: [{ text: 'Yes' }, { text: 'No', image: [{ url: 'https://yt3.ggpht.com/n' }] }] })
    expect(poll.postContent).toEqual({
      type: 'poll',
      totalVotes: 0,
      content: [{ text: 'Yes', image: undefined }, { text: 'No', image: [{ url: `${INSTANCE}/ggpht/n` }] }],
    })

    const quiz = await parsePost({ type: 'quiz', totalVotes: 7, choices: [{ text: 'A', isCorrect: true }] })
    expect(quiz.postContent).toEqual({ type: 'quiz', totalVotes: 7, content: [{ text: 'A', isCorrect: true, image: undefined }] })
  })

  it('surfaces attachment errors and logs unknown types', async () => {
    const errored = await parsePost({ error: 'This video is private' })
    expect(errored.postContent).toEqual({ type: 'error', message: 'This video is private' })

    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unknown = await parsePost({ type: 'mystery' })
    expect(unknown.postContent).toBeUndefined()
    expect(log).toHaveBeenCalled()
  })
})
