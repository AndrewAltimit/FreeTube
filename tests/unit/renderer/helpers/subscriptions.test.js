import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseYouTubeRSSFeed, updateVideoListAfterProcessing } from '../../../../src/renderer/helpers/subscriptions.js'

const getters = vi.hoisted(() => ({
  getHideLiveStreams: false,
  getHideUpcomingPremieres: false,
}))

vi.mock('../../../../src/renderer/store/index', () => ({
  default: { getters },
}))

const CHANNEL_ID = 'UCxxxxxxxxxxxxxxxxxxxxxx'

/**
 * @param {{ videoId: string, title: string, published: string, views?: string | null }[]} entries
 * @param {string} [author]
 */
function buildFeed(entries, author = 'Test Channel') {
  const entryXml = entries.map(({ videoId, title, published, views }) => {
    const statistics = views === null ? '' : `<media:statistics views="${views ?? '100'}"/>`
    return `
  <entry>
    <id>yt:video:${videoId}</id>
    <yt:videoId>${videoId}</yt:videoId>
    <yt:channelId>${CHANNEL_ID}</yt:channelId>
    <title>${title}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${videoId}"/>
    <author>
      <name>${author}</name>
      <uri>https://www.youtube.com/channel/${CHANNEL_ID}</uri>
    </author>
    <published>${published}</published>
    <updated>${published}</updated>
    <media:group>
      <media:title>${title}</media:title>
      <media:community>
        <media:starRating count="1" average="5.00" min="1" max="5"/>
        ${statistics}
      </media:community>
    </media:group>
  </entry>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}"/>
  <id>yt:channel:${CHANNEL_ID.slice(2)}</id>
  <yt:channelId>${CHANNEL_ID.slice(2)}</yt:channelId>
  <title>${author}</title>
  <author>
    <name>${author}</name>
    <uri>https://www.youtube.com/channel/${CHANNEL_ID}</uri>
  </author>
  <published>2015-01-01T00:00:00+00:00</published>${entryXml}
</feed>`
}

describe('updateVideoListAfterProcessing', () => {
  beforeEach(() => {
    getters.getHideLiveStreams = false
    getters.getHideUpcomingPremieres = false
  })

  it('sorts videos newest first', () => {
    const videos = [
      { videoId: 'a', published: 1000 },
      { videoId: 'b', published: 3000 },
      { videoId: 'c', published: 2000 },
    ]

    expect(updateVideoListAfterProcessing(videos).map(v => v.videoId)).toEqual(['b', 'c', 'a'])
  })

  it('returns an empty list for empty input', () => {
    getters.getHideLiveStreams = true
    getters.getHideUpcomingPremieres = true

    expect(updateVideoListAfterProcessing([])).toEqual([])
  })

  it('keeps live and upcoming videos when hiding live streams is off', () => {
    const videos = [
      { videoId: 'live', liveNow: true, published: 2 },
      { videoId: 'upcoming', isUpcoming: true, published: 1 },
    ]

    expect(updateVideoListAfterProcessing(videos)).toHaveLength(2)
  })

  it('removes live and upcoming videos when hiding live streams is on', () => {
    getters.getHideLiveStreams = true

    const videos = [
      { videoId: 'live', liveNow: true, published: 3 },
      { videoId: 'upcoming', isUpcoming: true, published: 2 },
      { videoId: 'normal', liveNow: false, isUpcoming: false, published: 1 },
    ]

    expect(updateVideoListAfterProcessing(videos).map(v => v.videoId)).toEqual(['normal'])
  })

  it('does not filter premieres when hiding upcoming premieres is off', () => {
    const videos = [
      { videoId: 'rss', isRSS: true, viewCount: '0', published: 2 },
      { videoId: 'local', premiereDate: new Date(), published: 1 },
    ]

    expect(updateVideoListAfterProcessing(videos)).toHaveLength(2)
  })

  it('keeps regular (non-premiere) API videos when hiding upcoming premieres', () => {
    getters.getHideUpcomingPremieres = true

    const videos = [{ videoId: 'normal', published: 1 }]

    expect(updateVideoListAfterProcessing(videos).map(v => v.videoId)).toEqual(['normal'])
  })

  it('removes RSS videos with a string view count of "0" when hiding upcoming premieres', () => {
    getters.getHideUpcomingPremieres = true

    const videos = [
      { videoId: 'premiere', isRSS: true, viewCount: '0', published: 2 },
      { videoId: 'watched', isRSS: true, viewCount: '15', published: 1 },
    ]

    expect(updateVideoListAfterProcessing(videos).map(v => v.videoId)).toEqual(['watched'])
  })

  // Regression: parseYouTubeRSSFeed produces `viewCount` as a number (or null); the
  // premiere filter used to compare only against the string '0', so RSS premieres
  // were never hidden.
  it('removes RSS videos with a numeric view count of 0 when hiding upcoming premieres', () => {
    getters.getHideUpcomingPremieres = true

    const videos = [
      { videoId: 'premiere', isRSS: true, viewCount: 0, published: 2 },
      { videoId: 'watched', isRSS: true, viewCount: 15, published: 1 },
    ]

    expect(updateVideoListAfterProcessing(videos).map(v => v.videoId)).toEqual(['watched'])
  })

  // Same regression, end-to-end through the real RSS parser.
  it('removes RSS premieres produced by parseYouTubeRSSFeed', async () => {
    getters.getHideUpcomingPremieres = true

    const { videos } = await parseYouTubeRSSFeed(buildFeed([
      { videoId: 'premiere000', title: 'Premiere', published: '2024-01-02T00:00:00+00:00', views: '0' },
      { videoId: 'normal00000', title: 'Normal', published: '2024-01-01T00:00:00+00:00', views: '42' },
    ]), CHANNEL_ID)

    expect(updateVideoListAfterProcessing(videos).map(v => v.videoId)).toEqual(['normal00000'])
  })

  // Regression: the non-RSS premiere check used to be `premiereDate == null ||
  // premiereTimestamp == null`. The Local API only sets `premiereDate` and Invidious
  // only sets `premiereTimestamp`, so one side was always null and nothing was
  // removed. Either field being set means "is a premiere" (as in FtListLazyWrapper.vue).
  it('removes Local API premieres (premiereDate set) when hiding upcoming premieres', () => {
    getters.getHideUpcomingPremieres = true

    const videos = [
      { videoId: 'premiere', premiereDate: new Date('2030-01-01'), published: 2 },
      { videoId: 'normal', published: 1 },
    ]

    expect(updateVideoListAfterProcessing(videos).map(v => v.videoId)).toEqual(['normal'])
  })

  it('removes Invidious premieres (premiereTimestamp set) when hiding upcoming premieres', () => {
    getters.getHideUpcomingPremieres = true

    const videos = [
      { videoId: 'premiere', premiereTimestamp: 1893456000, published: 2 },
      { videoId: 'normal', published: 1 },
    ]

    expect(updateVideoListAfterProcessing(videos).map(v => v.videoId)).toEqual(['normal'])
  })

  it('applies both filters together', () => {
    getters.getHideLiveStreams = true
    getters.getHideUpcomingPremieres = true

    const videos = [
      { videoId: 'live', liveNow: true, published: 4 },
      { videoId: 'rssPremiere', isRSS: true, viewCount: '0', published: 3 },
      { videoId: 'rss', isRSS: true, viewCount: '10', published: 2 },
      { videoId: 'api', published: 5 },
    ]

    expect(updateVideoListAfterProcessing(videos).map(v => v.videoId)).toEqual(['api', 'rss'])
  })
})

describe('parseYouTubeRSSFeed', () => {
  it('parses channel name and entries', async () => {
    const feed = buildFeed([
      { videoId: 'dQw4w9WgXcQ', title: 'First video', published: '2024-03-01T12:00:00+00:00', views: '1234' },
      { videoId: 'abcdefghijk', title: 'Second video', published: '2024-02-01T12:00:00+00:00', views: '5' },
    ], 'My Channel')

    const result = await parseYouTubeRSSFeed(feed, CHANNEL_ID)

    expect(result.name).toBe('My Channel')
    expect(result.videos).toHaveLength(2)
    expect(result.videos[0]).toEqual({
      authorId: CHANNEL_ID,
      author: 'My Channel',
      videoId: 'dQw4w9WgXcQ',
      title: 'First video',
      published: Date.parse('2024-03-01T12:00:00Z'),
      viewCount: 1234,
      type: 'video',
      lengthSeconds: '0:00',
      isRSS: true,
    })
    expect(result.videos[1].videoId).toBe('abcdefghijk')
    expect(result.videos[1].viewCount).toBe(5)
  })

  it('uses the passed channel id rather than the one in the feed', async () => {
    const result = await parseYouTubeRSSFeed(buildFeed([
      { videoId: 'dQw4w9WgXcQ', title: 'T', published: '2024-01-01T00:00:00+00:00' },
    ]), 'UCotherotherotherother00')

    expect(result.videos[0].authorId).toBe('UCotherotherotherother00')
  })

  it('returns the channel name and no videos for a feed without entries', async () => {
    const result = await parseYouTubeRSSFeed(buildFeed([], 'Empty Channel'), CHANNEL_ID)

    expect(result).toEqual({ name: 'Empty Channel', videos: [] })
  })

  it('parses the time zone offset in the published date', async () => {
    const result = await parseYouTubeRSSFeed(buildFeed([
      { videoId: 'dQw4w9WgXcQ', title: 'T', published: '2024-01-01T05:00:00+05:00' },
    ]), CHANNEL_ID)

    expect(result.videos[0].published).toBe(Date.UTC(2024, 0, 1, 0, 0, 0))
  })

  it('sets viewCount to null when statistics are missing', async () => {
    const result = await parseYouTubeRSSFeed(buildFeed([
      { videoId: 'dQw4w9WgXcQ', title: 'T', published: '2024-01-01T00:00:00+00:00', views: null },
    ]), CHANNEL_ID)

    expect(result.videos[0].viewCount).toBeNull()
  })

  it('sets viewCount to null when the views attribute is not a number', async () => {
    const result = await parseYouTubeRSSFeed(buildFeed([
      { videoId: 'dQw4w9WgXcQ', title: 'T', published: '2024-01-01T00:00:00+00:00', views: 'lots' },
    ]), CHANNEL_ID)

    expect(result.videos[0].viewCount).toBeNull()
  })

  it('parses a view count of "0" as the number 0', async () => {
    const result = await parseYouTubeRSSFeed(buildFeed([
      { videoId: 'dQw4w9WgXcQ', title: 'T', published: '2024-01-01T00:00:00+00:00', views: '0' },
    ]), CHANNEL_ID)

    expect(result.videos[0].viewCount).toBe(0)
  })

  it('decodes XML entities in titles', async () => {
    const result = await parseYouTubeRSSFeed(buildFeed([
      { videoId: 'dQw4w9WgXcQ', title: 'Tom &amp; Jerry &lt;3', published: '2024-01-01T00:00:00+00:00' },
    ]), CHANNEL_ID)

    expect(result.videos[0].title).toBe('Tom & Jerry <3')
  })

  it('returns an empty video list for malformed XML', async () => {
    expect(await parseYouTubeRSSFeed('<feed><unclosed>', CHANNEL_ID)).toEqual({ videos: [] })
  })

  it('returns an empty video list for an empty string', async () => {
    expect(await parseYouTubeRSSFeed('', CHANNEL_ID)).toEqual({ videos: [] })
  })

  it('returns an empty video list for an HTML error page', async () => {
    expect(await parseYouTubeRSSFeed('<html><body>404 Not Found</body></html>', CHANNEL_ID)).toEqual({ videos: [] })
  })

  it('returns an empty video list when an entry is missing its video id', async () => {
    const feed = buildFeed([
      { videoId: 'dQw4w9WgXcQ', title: 'T', published: '2024-01-01T00:00:00+00:00' },
    ]).replace(/<yt:videoId>[^<]*<\/yt:videoId>/, '')

    expect(await parseYouTubeRSSFeed(feed, CHANNEL_ID)).toEqual({ videos: [] })
  })
})
