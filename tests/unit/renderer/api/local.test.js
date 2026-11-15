import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Misc, YTNodes } from 'youtubei.js'

import {
  CHANNEL_ID,
  backstagePostRenderer,
  browseEndpoint,
  channelRenderer,
  gridPlaylistRenderer,
  gridVideoRenderer,
  lockupPlaylist,
  lockupVideo,
  parse,
  playlistRenderer,
  playlistVideoRenderer,
  reelItemRenderer,
  runs,
  shortsLockupViewModel,
  simple,
  videoRenderer,
} from './fixtures/innertube.js'

vi.mock('../../../../src/renderer/store/index.js', () => ({ default: { getters: {} } }))
vi.mock('../../../../src/renderer/router/index.js', () => ({ default: {} }))
vi.mock('../../../../src/renderer/i18n/index.js', () => ({
  default: { global: { t: (key) => key, locale: { value: 'en-US' } } },
}))

const local = await import('../../../../src/renderer/helpers/api/local.js')

const NOW = new Date('2026-01-15T12:00:00Z').getTime()
const DAY = 86400000

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})

describe('parseLocalSubscriberCount', () => {
  it.each([
    ['1.5K subscribers', 1500],
    ['1.23M views', 1230000],
    ['2B', 2000000000],
    ['12k', 12000],
    ['3 million', 3000000],
    ['1,5 M', 1500000],
    ['999 subscribers', 999],
    ['1,234,567 views', 1234567],
  ])('%s -> %d', (text, expected) => {
    expect(local.parseLocalSubscriberCount(text)).toBe(expected)
  })

  it('does not treat unit words like "months" as a multiplier', () => {
    expect(local.parseLocalSubscriberCount('5 months')).toBe(5)
  })

  it('returns NaN when there is no number', () => {
    expect(local.parseLocalSubscriberCount('No views')).toBeNaN()
  })
})

describe('parseLocalTextRuns', () => {
  const text = (rawRuns) => new Misc.Text({ runs: rawRuns }).runs

  it('escapes HTML and applies bold/italic/strikethrough', () => {
    const result = local.parseLocalTextRuns(text([
      { text: '<script>' },
      { text: 'b', bold: true },
      { text: 'i', italics: true },
      { text: 's', strikethrough: true, bold: true },
    ]))
    expect(result).toBe('&lt;script&gt;<b>b</b><i>i</i><s><b>s</b></s>')
  })

  it('keeps timestamps as text but expands other watch links', () => {
    const watch = (url) => ({ commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_WATCH' } }, watchEndpoint: { videoId: 'x' } })
    expect(local.parseLocalTextRuns(text([
      { text: '1:02:03', navigationEndpoint: watch('/watch?v=x&t=3723s') },
      { text: ' ' },
      { text: 'a video', navigationEndpoint: watch('/watch?v=y') },
    ]))).toBe('1:02:03 https://www.youtube.com/watch?v=y')
  })

  it('links channel handles and preserves surrounding whitespace', () => {
    const result = local.parseLocalTextRuns(text([
      { text: ' @somechannel ', navigationEndpoint: browseEndpoint('UCabc', '/@somechannel') },
    ]))
    expect(result).toBe(' <a href="https://www.youtube.com/channel/UCabc">@somechannel</a> ')
  })

  it('only links channel names that are not handles in loose mode', () => {
    const rawRuns = [{ text: 'Some Name', navigationEndpoint: browseEndpoint('UCabc', '/channel/UCabc') }]
    expect(local.parseLocalTextRuns(text(rawRuns))).toBe('https://www.youtube.com/channel/UCabc')
    expect(local.parseLocalTextRuns(text(rawRuns), 16, { looseChannelNameDetection: true }))
      .toBe('<a href="https://www.youtube.com/channel/UCabc">Some Name</a>')
  })

  it('unwraps YouTube redirect links and strips utm parameters', () => {
    const redirect = (target) => ({
      commandMetadata: { webCommandMetadata: { url: 'x', webPageType: 'WEB_PAGE_TYPE_UNKNOWN' } },
      urlEndpoint: { url: `https://www.youtube.com/redirect?event=desc&q=${encodeURIComponent(target)}` },
    })

    expect(local.parseLocalTextRuns(text([
      { text: 'link', navigationEndpoint: redirect('https://example.com/a?utm_source=yt&keep=1') },
    ]))).toBe('https://example.com/a?keep=1')

    // untouched when there is nothing to strip (keeps the original string form)
    expect(local.parseLocalTextRuns(text([
      { text: 'link', navigationEndpoint: redirect('https://example.com/a?b=%20') },
    ]))).toBe('https://example.com/a?b=%20')
  })

  it('passes non-redirect external URLs through', () => {
    expect(local.parseLocalTextRuns(text([{
      text: 'x',
      navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: 'x', webPageType: 'WEB_PAGE_TYPE_UNKNOWN' } }, urlEndpoint: { url: 'https://example.org/' } },
    }]))).toBe('https://example.org/')
  })

  it('renders emoji images with a size and alt text, skipping removed custom emoji', () => {
    const image = { thumbnails: [{ url: 'https://yt3.ggpht.com/emoji', width: 24, height: 24 }] }
    const result = local.parseLocalTextRuns(text([
      { emoji: { emojiId: 'UCx/abc', shortcuts: [':wave:'], isCustomEmoji: true, image } },
      { emoji: { emojiId: '😀', shortcuts: [':grinning:'], image } },
      { emoji: { emojiId: 'UCx/gone', isCustomEmoji: true, image: { thumbnails: [] } } },
    ]), 20)

    expect(result).toBe(
      '<img src="https://yt3.ggpht.com/emoji" alt=":wave:" width="20" height="20" loading="lazy" style="vertical-align: middle">' +
      '<img src="https://yt3.ggpht.com/emoji" alt="😀" width="20" height="20" loading="lazy" style="vertical-align: middle">'
    )
  })

  it('throws for non-array input', () => {
    expect(() => local.parseLocalTextRuns(undefined)).toThrow('not an array of text runs')
  })
})

describe('parseLocalListVideo (Video)', () => {
  it('normalizes a regular search result', () => {
    const video = local.parseLocalListVideo(parse(videoRenderer({ title: '  Padded  ', badges: [['4K'], ['CC'], ['New']] })))

    expect(video).toMatchObject({
      type: 'video',
      videoId: 'video000001',
      title: 'Padded',
      author: 'Some Channel',
      authorId: CHANNEL_ID,
      viewCount: 1234567,
      published: NOW - 2 * DAY,
      lengthSeconds: 3723,
      liveNow: false,
      isUpcoming: false,
      is4k: true,
      hasCaptions: true,
      isNew: true,
      is8k: false,
      collaborators: [],
    })
  })

  it('parses "No views" as 0 and falls back to the short view count', () => {
    expect(local.parseLocalListVideo(parse(videoRenderer({ views: 'No views' }))).viewCount).toBe(0)
    expect(local.parseLocalListVideo(parse(videoRenderer({ views: null, shortViews: '3.4K views' }))).viewCount).toBe(3400)
    expect(local.parseLocalListVideo(parse(videoRenderer({ views: null }))).viewCount).toBeNull()
  })

  it('marks live streams and dates them "now"', () => {
    const video = local.parseLocalListVideo(parse(videoRenderer({
      length: null,
      published: null,
      views: '1.2K watching',
      badges: [['LIVE', 'BADGE_STYLE_TYPE_LIVE_NOW']],
      overlayStyle: 'LIVE',
    })))
    expect(video.liveNow).toBe(true)
    expect(video.published).toBe(NOW)
    // the "LIVE" overlay text isn't a duration
    expect(video.lengthSeconds).toBe('')
  })

  it('uses the premiere date for upcoming videos', () => {
    const start = Math.floor(NOW / 1000) + 3600
    const video = local.parseLocalListVideo(parse(videoRenderer({ upcomingStart: start, published: null, badges: [['PREMIERE']] })))
    expect(video.isUpcoming).toBe(true)
    expect(video.isPremiere).toBe(true)
    expect(video.premiereDate).toEqual(new Date(start * 1000))
    expect(video.published).toBe(start * 1000)
  })

  it('falls back to the provided channel name when the owner is missing', () => {
    const video = local.parseLocalListVideo(parse(videoRenderer({ owner: null })), 'UCfallback', 'Fallback')
    expect(video.author).toBe('Fallback')
  })

  // Suspected bug (local.js:1948, same pattern at :1850 Movie and :1902 GridMovie):
  // the authorId fallback checks `video.author.id !== 'N/A'`, but youtubei.js' Author
  // only uses 'N/A' for the *name*; a missing owner leaves `id` undefined. So videos
  // without ownerText (e.g. on channel tabs) get authorId undefined instead of channelId.
  // The GridVideo branch (:1885) already does the right `!= null` check.
  it.fails('falls back to the provided channel id when the owner is missing', () => {
    const video = local.parseLocalListVideo(parse(videoRenderer({ owner: null })), 'UCfallback', 'Fallback')
    expect(video.authorId).toBe('UCfallback')
  })

  it('drops members-only and unavailable videos', () => {
    expect(local.parseLocalListVideo(parse(videoRenderer({ badges: [['Members only', 'BADGE_STYLE_TYPE_MEMBERS_ONLY']] })))).toBeNull()
    expect(local.parseLocalListVideo(parse(videoRenderer({ title: 'This video isn\'t publicly available' })))).toBeNull()
  })
})

describe('parseLocalListVideo (GridVideo)', () => {
  it('normalizes a grid video with channel fallbacks', () => {
    const video = local.parseLocalListVideo(parse(gridVideoRenderer()), 'UCx', 'Channel X')
    expect(video).toMatchObject({
      videoId: 'grid0000001',
      title: 'Grid video',
      author: 'Channel X',
      authorId: 'UCx',
      viewCount: 12345,
      lengthSeconds: 245,
      liveNow: false,
      published: NOW - 3 * 7 * DAY,
      collaborators: [],
    })
  })

  it('detects live grid videos from the LIVE duration text', () => {
    const video = local.parseLocalListVideo(parse(gridVideoRenderer({ length: 'LIVE', published: null })))
    expect(video.liveNow).toBe(true)
    expect(video.lengthSeconds).toBe('')
  })

  it('returns null for unavailable clips without a video id', () => {
    expect(local.parseLocalListVideo(parse(gridVideoRenderer({ videoId: null })))).toBeNull()
  })
})

describe('parseLockupView (via parseLocalListVideo / parseLocalListPlaylist)', () => {
  const channelEndpoint = { ...browseEndpoint(CHANNEL_ID) }

  it('reads author, views, publish time and duration from metadata rows', () => {
    const video = local.parseLocalListVideo(parse(lockupVideo({
      rows: [[{ text: 'Lockup Channel', endpoint: channelEndpoint }], [{ text: '1.2M views' }, { text: '3 days ago' }]],
      avatarChannelId: CHANNEL_ID,
    })))

    expect(video).toMatchObject({
      type: 'video',
      videoId: 'lockup00001',
      title: 'Lockup video',
      author: 'Lockup Channel',
      authorId: CHANNEL_ID,
      viewCount: 1200000,
      published: NOW - 3 * DAY,
      lengthSeconds: 601,
      liveNow: false,
      isUpcoming: false,
      isStation: false,
    })
  })

  it('accepts "Streamed N ago" publish text', () => {
    const video = local.parseLocalListVideo(parse(lockupVideo({ rows: [[{ text: 'C' }], [{ text: '10 views' }, { text: 'Streamed 2 weeks ago' }]] })))
    expect(video.viewCount).toBe(10)
    expect(video.published).toBe(NOW - 14 * DAY)
  })

  it('detects live lockups and live premieres', () => {
    const live = local.parseLocalListVideo(parse(lockupVideo({
      rows: [[{ text: 'C' }], [{ text: '5K watching' }]],
      bottomBadges: [{ text: 'LIVE', badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE' }, { text: 'PREMIERE' }],
    })))
    expect(live).toMatchObject({ liveNow: true, isPremiere: true, viewCount: 5000, published: NOW, lengthSeconds: '' })
  })

  it('parses the premiere date of upcoming lockups', () => {
    const video = local.parseLocalListVideo(parse(lockupVideo({
      rows: [[{ text: 'C' }], [{ text: '12 waiting' }, { text: 'Premieres 2/1/26, 10:00 AM' }]],
      bottomBadges: [{ text: 'Upcoming' }],
    })))
    // relies on the JS engine's lenient Date parsing of the English text
    const expected = new Date(2026, 1, 1, 10, 0)
    expect(video.isUpcoming).toBe(true)
    expect(video.premiereDate).toEqual(expected)
    expect(video.published).toBe(expected.getTime())
  })

  it('does not use view-count text as the author', () => {
    const video = local.parseLocalListVideo(parse(lockupVideo({ rows: [[{ text: '99 views' }]] })), 'UCx', 'Fallback')
    expect(video.author).toBe('Fallback')
    expect(video.authorId).toBe('UCx')
  })

  it('flags music and filters members-only lockups', () => {
    const music = local.parseLocalListVideo(parse(lockupVideo({ rows: [[{ text: 'C' }]], bottomBadges: [{ text: '3:00', icon: 'MUSIC' }] })))
    expect(music.isMusic).toBe(true)

    const members = local.parseLocalListVideo(parse(lockupVideo({ rows: [[{ text: 'C' }]], rowBadges: ['BADGE_MEMBERS_ONLY'] })))
    expect(members).toBeNull()
  })

  it('returns null and warns for unknown lockup content types', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(local.parseLocalListVideo(parse(lockupVideo({ contentType: 'LOCKUP_CONTENT_TYPE_SOMETHING' })))).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('normalizes playlist lockups and takes the channel from the metadata link', () => {
    const playlist = local.parseLocalListPlaylist(parse(lockupPlaylist({ channel: { name: 'Owner', id: 'UCowner' } })))
    expect(playlist).toEqual({
      type: 'playlist',
      dataSource: 'local',
      playlistId: 'PLlockup',
      title: 'Lockup playlist',
      thumbnail: 'https://i.ytimg.com/vi/pl/hq.jpg',
      channelName: 'Owner',
      channelId: 'UCowner',
      videoCount: 42,
      isPodcast: false,
      isAlbum: false,
      isCourse: false,
      isShow: false,
    })
  })

  it('sets the album/course/podcast flags from the content type and badge icon', () => {
    expect(local.parseLocalListPlaylist(parse(lockupPlaylist({ badgeIcon: 'music' }))).isAlbum).toBe(true)
    expect(local.parseLocalListPlaylist(parse(lockupPlaylist({ contentType: 'LOCKUP_CONTENT_TYPE_COURSE' }))).isCourse).toBe(true)
    expect(local.parseLocalListPlaylist(parse(lockupPlaylist({ contentType: 'LOCKUP_CONTENT_TYPE_PODCAST' }))).isPodcast).toBe(true)
  })

  it('filters out watch-page-only mixes but keeps RDCL mixes', () => {
    expect(local.parseLocalListPlaylist(parse(lockupPlaylist({ contentId: 'RDabc' })))).toBeNull()
    expect(local.parseLocalListPlaylist(parse(lockupPlaylist({ contentId: 'RDCLAKabc' })))).not.toBeNull()
  })
})

describe('shorts', () => {
  it('parses ReelItem shorts', () => {
    expect(local.parseShort(parse(reelItemRenderer()), 'UCx', 'X')).toEqual({
      type: 'video',
      videoId: 'short000001',
      title: 'Short title',
      author: 'X',
      authorId: 'UCx',
      viewCount: 1200000,
      lengthSeconds: '',
    })
    expect(local.parseShort(parse(reelItemRenderer({ views: null }))).viewCount).toBeNull()
  })

  it('parses ShortsLockupView shorts', () => {
    const shorts = local.parseLocalChannelShorts([parse(shortsLockupViewModel()), parse(shortsLockupViewModel({ views: null }))], 'UCx', 'X')
    expect(shorts[0]).toMatchObject({ videoId: 'short000002', title: 'Lockup short', viewCount: 35000, author: 'X', authorId: 'UCx' })
    expect(shorts[1].viewCount).toBeNull()
  })
})

describe('parseLocalListPlaylist', () => {
  it('normalizes a search Playlist with an owner', () => {
    expect(local.parseLocalListPlaylist(parse(playlistRenderer({ owner: { name: 'Owner', id: 'UCowner' } })))).toEqual({
      type: 'playlist',
      dataSource: 'local',
      title: 'A playlist',
      thumbnail: 'https://i.ytimg.com/vi/p/hq.jpg',
      channelName: 'Owner',
      channelId: 'UCowner',
      playlistId: 'PLplaylist',
      videoCount: 1234,
      isCourse: false,
      isAlbum: false,
    })
  })

  it('uses the provided channel for ownerless playlists', () => {
    const playlist = local.parseLocalListPlaylist(parse(playlistRenderer()), 'UCx', 'X')
    expect([playlist.channelName, playlist.channelId]).toEqual(['X', 'UCx'])
  })

  it('handles text bylines without a channel id', () => {
    const playlist = local.parseLocalListPlaylist(parse(playlistRenderer({ shortByline: 'Byline' })))
    expect([playlist.channelName, playlist.channelId]).toEqual(['Byline', null])
  })

  it('flags course and album playlists from thumbnail overlays', () => {
    expect(local.parseLocalListPlaylist(parse(playlistRenderer({ overlays: ['COURSE'] }))).isCourse).toBe(true)
    expect(local.parseLocalListPlaylist(parse(playlistRenderer({ overlays: ['MUSIC'] }))).isAlbum).toBe(true)
  })

  it('normalizes a GridPlaylist', () => {
    expect(local.parseLocalListPlaylist(parse(gridPlaylistRenderer({ music: true })))).toEqual({
      type: 'playlist',
      dataSource: 'local',
      title: 'Grid playlist',
      thumbnail: 'https://i.ytimg.com/vi/g/hq.jpg',
      playlistId: 'PLgrid',
      channelName: 'Some Channel',
      channelId: CHANNEL_ID,
      videoCount: 15,
      isAlbum: true,
    })
  })
})

describe('parseLocalPlaylistVideos', () => {
  it('parses normal playlist videos, published date and view count', () => {
    const [video] = local.parseLocalPlaylistVideos([parse(playlistVideoRenderer())])
    expect(video).toEqual({
      type: 'video',
      videoId: 'plvideo0001',
      title: 'Playlist video',
      author: 'Uploader',
      authorId: 'UCuploader',
      viewCount: 5300,
      published: NOW - 31556952000,
      lengthSeconds: 125,
      liveNow: false,
      isUpcoming: false,
      premiereDate: undefined,
    })
  })

  it('takes the published date from plain text when the view count is hidden', () => {
    const [video] = local.parseLocalPlaylistVideos([parse(playlistVideoRenderer({ info: simple('4 hours ago') }))])
    expect(video.viewCount).toBeNull()
    expect(video.published).toBe(NOW - 4 * 3600000)
  })

  it('handles live and upcoming entries', () => {
    const start = Math.floor(NOW / 1000) + 600
    const [live, upcoming] = local.parseLocalPlaylistVideos([
      parse(playlistVideoRenderer({ style: 'LIVE', lengthSeconds: null, info: { runs: [{ text: '1.1K watching' }, { text: ' ' }] } })),
      parse(playlistVideoRenderer({ style: 'UPCOMING', lengthSeconds: null, upcomingStart: start, info: { runs: [{ text: '20 waiting' }] } })),
    ])
    expect(live).toMatchObject({ liveNow: true, published: NOW, lengthSeconds: '', viewCount: 1100 })
    expect(upcoming).toMatchObject({ isUpcoming: true, published: start * 1000, premiereDate: new Date(start * 1000) })
  })

  it('treats N/A authors as unknown', () => {
    const raw = playlistVideoRenderer()
    delete raw.playlistVideoRenderer.shortBylineText
    const [video] = local.parseLocalPlaylistVideos([parse(raw)])
    expect(video.authorId).toBeNull()
  })

  it('parses shorts in playlists, with the view count from accessibility text', () => {
    const [reel, lockup, noViews] = local.parseLocalPlaylistVideos([
      parse(reelItemRenderer()),
      // the title contains a decoy view count; the last match wins
      parse(shortsLockupViewModel({ accessibilityText: 'Top 10 views of Paris, 2.5 million views - play Short' })),
      parse(shortsLockupViewModel({ accessibilityText: 'Fresh upload, no views - play Short' })),
    ])
    expect(reel).toMatchObject({ videoId: 'short000001', viewCount: 1200000 })
    expect(lockup.viewCount).toBe(2500000)
    expect(noViews.viewCount).toBe(0)
  })
})

describe('parseChannelHomeTab', () => {
  it('builds shelves, skips members-only shelves and flags community shelves', () => {
    const homeTab = {
      current_tab: {
        content: {
          contents: [
            {
              type: 'ItemSection',
              contents: [{
                type: 'Shelf',
                title: { text: 'Uploads' },
                subtitle: { text: 'sub' },
                play_all_button: { endpoint: { payload: { playlistId: 'UUx' } } },
                content: { items: [parse(gridVideoRenderer()), parse(reelItemRenderer())] },
              }],
            },
            {
              type: 'ItemSection',
              contents: [{
                type: 'Shelf',
                title: { text: 'Members only' },
                play_all_button: { endpoint: { payload: { playlistId: 'UUMOx' } } },
                content: { items: [parse(gridVideoRenderer())] },
              }],
            },
            {
              type: 'ItemSection',
              contents: [{ type: 'ReelShelf', title: { text: 'Shorts' }, items: [parse(reelItemRenderer())] }],
            },
            {
              type: 'RichSection',
              content: {
                type: 'RichShelf',
                title: { text: 'Posts' },
                endpoint: { metadata: { url: '/playlist?list=PLrich' } },
                contents: [{ content: parse({ postRenderer: backstagePostRenderer().backstagePostRenderer }) }],
              },
            },
          ],
        },
      },
    }

    const shelves = local.parseChannelHomeTab(homeTab, 'UCx', 'X')

    expect(shelves.map(s => s.title)).toEqual(['Uploads', 'Shorts', 'Posts'])
    expect(shelves[0]).toMatchObject({ playlistId: 'UUx', subtitle: 'sub', isCommunity: false })
    expect(shelves[0].content.map(c => c.videoId)).toEqual(['grid0000001', 'short000001'])
    expect(shelves[0].content[0].authorId).toBe('UCx')
    expect(shelves[2]).toMatchObject({ playlistId: 'PLrich', isCommunity: true })
    expect(shelves[2].content[0].type).toBe('community')
  })

  it('parses channel and hashtag items through parseListItem', () => {
    const shelves = local.parseChannelHomeTab({
      current_tab: {
        content: {
          contents: [{
            type: 'ItemSection',
            contents: [{
              type: 'Shelf',
              title: { text: 'Mixed' },
              content: {
                items: [
                  parse(channelRenderer()),
                  parse(channelRenderer({ handle: null, subs: '2.3K subscribers', videos: '45 videos' })),
                  parse({ hashtagTileRenderer: { hashtag: simple('#cats'), hashtagVideoCount: simple('1.1K videos'), hashtagChannelCount: simple('300 channels') } }),
                ],
              },
            }],
          }],
        },
      },
    })

    const [newLayout, oldLayout, hashtag] = shelves[0].content
    expect(newLayout).toEqual({
      type: 'channel',
      dataSource: 'local',
      thumbnail: 'https://yt3.ggpht.com/avatar=s88',
      name: 'Some Channel',
      id: CHANNEL_ID,
      subscribers: 1500000,
      videos: null,
      handle: '@somechannel',
      descriptionShort: 'About this channel',
    })
    expect(oldLayout).toMatchObject({ handle: null, subscribers: 2300, videos: 45 })
    expect(hashtag).toEqual({ type: 'hashtag', title: '#cats', videoCount: 1100, channelCount: 300 })
  })
})

describe('parseLocalChannelHeader', () => {
  it('parses a C4TabbedHeader', () => {
    const channel = {
      header: {
        type: 'C4TabbedHeader',
        author: { id: 'UCc4', name: 'C4 Channel', best_thumbnail: { url: 'https://yt3.ggpht.com/c4' } },
        banner: [{ url: 'https://yt3.ggpht.com/banner' }],
        subscribers: { text: '10M subscribers' },
      },
    }
    expect(local.parseLocalChannelHeader(channel)).toEqual({
      id: 'UCc4',
      name: 'C4 Channel',
      thumbnailUrl: 'https://yt3.ggpht.com/c4',
      bannerUrl: 'https://yt3.ggpht.com/banner',
      subscriberText: '10M subscribers',
      tags: [],
    })
    expect(local.parseLocalChannelHeader(channel, true)).toEqual({ id: 'UCc4', name: 'C4 Channel', thumbnailUrl: 'https://yt3.ggpht.com/c4' })
  })

  it('parses a PageHeader, searching metadata rows for the subscriber count', () => {
    const channel = {
      metadata: { external_id: 'UCpage', thumbnail: [{ url: 'https://yt3.ggpht.com/meta' }] },
      header: {
        type: 'PageHeader',
        content: {
          title: { text: { text: 'Page Channel' } },
          image: { type: 'DecoratedAvatarView', avatar: { image: [{ url: 'https://yt3.ggpht.com/avatar' }] } },
          banner: { image: [{ url: 'https://yt3.ggpht.com/banner' }] },
          metadata: {
            metadata_rows: [
              { metadata_parts: [{ text: { text: '@page' } }] },
              { metadata_parts: [{ text: { text: '1.2M subscribers' } }, { text: { text: '300 videos' } }] },
            ],
          },
        },
      },
    }
    expect(local.parseLocalChannelHeader(channel)).toEqual({
      id: 'UCpage',
      name: 'Page Channel',
      thumbnailUrl: 'https://yt3.ggpht.com/avatar',
      bannerUrl: 'https://yt3.ggpht.com/banner',
      subscriberText: '1.2M subscribers',
      tags: [],
    })
  })

  it('falls back to the metadata thumbnail when the PageHeader has no image', () => {
    const channel = {
      metadata: { external_id: 'UCpage', thumbnail: [{ url: 'https://yt3.ggpht.com/meta' }] },
      header: { type: 'PageHeader', content: { title: { text: { text: 'P' } } } },
    }
    expect(local.parseLocalChannelHeader(channel, true).thumbnailUrl).toBe('https://yt3.ggpht.com/meta')
  })

  it('parses an InteractiveTabbedHeader with badges as tags', () => {
    const channel = {
      current_tab: { endpoint: { payload: { browseId: 'UCgame' } } },
      header: {
        type: 'InteractiveTabbedHeader',
        title: { text: 'Minecraft' },
        box_art: [{ url: 'small' }, { url: 'large' }],
        banner: [{ url: 'banner' }],
        badges: [{ label: '2011' }, { label: '' }, { label: 'Sandbox' }],
      },
    }
    expect(local.parseLocalChannelHeader(channel)).toMatchObject({ id: 'UCgame', name: 'Minecraft', thumbnailUrl: 'large', tags: ['2011', 'Sandbox'] })
  })
})

describe('parseLocalChannelAboutLinks', () => {
  const endpoint = (url) => new YTNodes.NavigationEndpoint({
    commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_UNKNOWN' } },
    urlEndpoint: { url },
  })

  it('unwraps redirects, adds a scheme to bare domains and drops unsafe links', () => {
    const about = {
      metadata: {
        links: [
          { title: { text: ' Site ' }, link: { endpoint: endpoint('https://www.youtube.com/redirect?q=https%3A%2F%2Fwww.example.com%2Fa') }, favicon: [{ url: 'icon' }] },
          { title: { text: 'Bare' }, link: { endpoint: endpoint('https://www.youtube.com/redirect?q=shop.example.com%2Fx') } },
          { title: { text: 'Direct' }, link: { endpoint: endpoint('http://example.net/') } },
          { title: { text: 'Bad' }, link: { endpoint: endpoint('https://www.youtube.com/redirect?q=javascript%3Aalert(1)') } },
          { title: { text: 'Empty' }, link: { endpoint: endpoint('https://www.youtube.com/redirect?event=x') } },
        ],
      },
    }

    expect(local.parseLocalChannelAboutLinks(about)).toEqual([
      { title: 'Site', url: 'https://www.example.com/a', displayUrl: 'example.com/a', iconUrl: 'icon' },
      { title: 'Bare', url: 'https://shop.example.com/x', displayUrl: 'shop.example.com/x', iconUrl: '' },
      { title: 'Direct', url: 'http://example.net/', displayUrl: 'example.net/', iconUrl: '' },
    ])
  })

  it('accepts the ChannelAboutFullMetadata primary_links shape', () => {
    const about = { primary_links: [{ title: { text: 'X' }, endpoint: endpoint('https://example.com/'), icon: [{ url: 'i' }] }] }
    expect(local.parseLocalChannelAboutLinks(about)).toEqual([{ title: 'X', url: 'https://example.com/', displayUrl: 'example.com/', iconUrl: 'i' }])
  })
})

describe('parseLocalComment', () => {
  const comment = (overrides = {}) => ({
    comment_id: 'Ugc',
    author: { name: '@someone', id: 'UCsomeone', best_thumbnail: { url: 'https://yt3.ggpht.com/a' } },
    content: new Misc.Text({ runs: [{ text: 'Visit https://example.com' }] }),
    published_time: '3 days ago (edited)',
    like_count: '1.2K',
    is_pinned: false,
    ...overrides,
  })

  it('normalizes a top-level comment with replies', () => {
    const thread = { has_replies: true, comment_replies_data: { has_channel_owner_replied: true, view_replies: { text: '12 replies' } } }
    const parsed = local.parseLocalComment(comment({ author_is_channel_owner: true, is_hearted: true, member_badge: { url: 'badge' } }), thread)

    expect(parsed).toMatchObject({
      id: 'Ugc',
      dataType: 'local',
      author: '@someone',
      authorId: 'UCsomeone',
      authorThumb: 'https://yt3.ggpht.com/a',
      isOwner: true,
      isHearted: true,
      isMember: false,
      memberIconUrl: 'badge',
      likes: 1200,
      hasOwnerReplied: true,
      hasReplyToken: true,
      replyToken: thread,
      numReplies: 12,
      replyLevel: 0,
      // "(edited)" is stripped before parsing the date
      time: '3 days ago',
    })
    expect(parsed.text).toContain('<a href="https://example.com"')
  })

  it('defaults missing fields for replies and deleted authors', () => {
    const parsed = local.parseLocalComment(comment({ author: undefined, like_count: undefined, reply_level: 1 }))
    expect(parsed).toMatchObject({ author: '', authorId: '', authorThumb: '', likes: 0, numReplies: 0, hasReplyToken: false, replyToken: null, replyLevel: 1 })
  })

  it('uses the voice reply transcript when present', () => {
    const parsed = local.parseLocalComment(comment({ voice_reply_container: { transcript_text: new Misc.Text({ runs: [{ text: 'spoken words' }] }) } }))
    expect(parsed.text).toBe('spoken words')
  })
})

describe('parseLocalCommunityPosts', () => {
  it('normalizes posts and makes protocol-relative avatars absolute', () => {
    const [post] = local.parseLocalCommunityPosts([parse(backstagePostRenderer({ replies: '15' }))])
    expect(post).toMatchObject({
      postText: 'Hello world',
      postId: 'UgkxPost',
      publishedTime: NOW - DAY,
      voteCount: 1200,
      postContent: null,
      commentCount: 15,
      authorId: CHANNEL_ID,
      author: 'Some Channel',
      type: 'community',
    })
    expect(post.authorThumbnails[0].url).toBe('https://yt3.ggpht.com/avatar=s88')
  })

  it('defaults hidden vote counts to 0 and missing reply buttons to null', () => {
    const [post] = local.parseLocalCommunityPosts([parse(backstagePostRenderer({ votes: null, content: {} }))])
    expect(post.voteCount).toBe(0)
    expect(post.commentCount).toBeNull()
    expect(post.postText).toBe('')
  })

  it('removes shared posts and the posts they embed', () => {
    const posts = [
      { type: 'SharedPost', id: 'shared', original_post: { id: 'original' } },
      parse(backstagePostRenderer({ postId: 'original' })),
      parse(backstagePostRenderer({ postId: 'standalone' })),
    ]
    expect(local.parseLocalCommunityPosts(posts).map(p => p.postId)).toEqual(['standalone'])
  })

  it('parses image, poll and video attachments', () => {
    const image = local.parseLocalCommunityPosts([parse(backstagePostRenderer({
      attachment: { backstageImageRenderer: { image: { thumbnails: [{ url: 'https://yt3.ggpht.com/img', width: 1, height: 1 }] } } },
    }))])[0]
    expect(image.postContent).toEqual({ type: 'image', content: [expect.objectContaining({ url: 'https://yt3.ggpht.com/img' })] })

    const poll = local.parseLocalCommunityPosts([parse(backstagePostRenderer({
      attachment: { pollRenderer: { totalVotes: simple('1.5K votes'), choices: [{ text: runs('Yes') }, { text: runs('No') }] } },
    }))])[0]
    expect(poll.postContent).toEqual({ type: 'poll', totalVotes: 1500, content: [{ text: 'Yes', image: null }, { text: 'No', image: null }] })

    const video = local.parseLocalCommunityPosts([parse(backstagePostRenderer({ attachment: videoRenderer() }))])[0]
    expect(video.postContent.type).toBe('video')
    expect(video.postContent.content.videoId).toBe('video000001')

    const membersVideo = local.parseLocalCommunityPosts([parse(backstagePostRenderer({
      attachment: videoRenderer({ badges: [['Members only', 'BADGE_STYLE_TYPE_MEMBERS_ONLY']] }),
    }))])[0]
    expect(membersVideo.postContent).toBeNull()
  })
})

describe('parseLocalWatchNextVideo', () => {
  it('parses lockup recommendations', () => {
    const video = local.parseLocalWatchNextVideo(parse(lockupVideo({ rows: [[{ text: 'C' }], [{ text: '1 view' }, { text: '1 hour ago' }]] })))
    expect(video).toMatchObject({ videoId: 'lockup00001', viewCount: 1, published: NOW - 3600000 })
  })

  it('parses CompactVideo recommendations', () => {
    const video = local.parseLocalWatchNextVideo(parse({
      compactVideoRenderer: {
        videoId: 'compact0001',
        title: simple('Compact'),
        longBylineText: runs('Uploader', browseEndpoint('UCup')),
        shortBylineText: runs('Uploader', browseEndpoint('UCup')),
        viewCountText: simple('4,321 views'),
        publishedTimeText: simple('5 years ago'),
        lengthText: simple('10:00'),
        thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: simple('10:00'), style: 'DEFAULT' } }],
      },
    }))
    expect(video).toMatchObject({
      type: 'video',
      videoId: 'compact0001',
      title: 'Compact',
      author: 'Uploader',
      authorId: 'UCup',
      viewCount: 4321,
      published: NOW - 5 * 31556952000,
      lengthSeconds: 600,
      liveNow: false,
    })
  })
})

describe('mapLocalLegacyFormat', () => {
  it('maps youtubei.js format fields to the legacy shape', () => {
    expect(local.mapLocalLegacyFormat({
      itag: 18, quality_label: '360p', fps: 30, bitrate: 500000, mime_type: 'video/mp4', height: 360, width: 640, freeTubeUrl: 'https://x',
    })).toEqual({ itag: 18, qualityLabel: '360p', fps: 30, bitrate: 500000, mimeType: 'video/mp4', height: 360, width: 640, url: 'https://x' })
  })
})

describe('extractLocalContentDisclosures', () => {
  function info(items) {
    const panel = parse({
      engagementPanelSectionListRenderer: {
        targetId: 'engagement-panel-structured-description',
        content: { structuredDescriptionContentRenderer: { items } },
      },
    })
    return { page: [{}, { engagement_panels: [panel] }] }
  }

  it('extracts "how this was made" sections without the trailing "Learn more"', () => {
    const result = local.extractLocalContentDisclosures(info([{
      howThisWasMadeSectionViewModel: {
        bodyHeader: { content: 'Altered or synthetic content' },
        bodyText: { content: 'Sound or visuals were significantly edited. Learn more' },
        attributionText: { content: 'Info from the creator' },
      },
    }]))
    expect(result).toEqual([{ label: 'Altered or synthetic content', description: 'Sound or visuals were significantly edited.', attribution: 'Info from the creator' }])
  })

  it('returns null without disclosures', () => {
    expect(local.extractLocalContentDisclosures(info([]))).toBeNull()
    expect(local.extractLocalContentDisclosures({ page: [{}] })).toBeNull()
    expect(local.extractLocalContentDisclosures(undefined)).toBeNull()
  })
})
