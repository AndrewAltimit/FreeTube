import { beforeEach, describe, expect, it, vi } from 'vitest'
import shaka from 'shaka-player'

const i18nState = vi.hoisted(() => ({ locale: { value: 'en-US' } }))

vi.mock('../../../../src/renderer/i18n/index.js', () => ({
  default: { global: { t: (key) => `t:${key}`, locale: i18nState.locale } },
}))
vi.mock('../../../../src/renderer/router/index.js', () => ({ default: {} }))
vi.mock('../../../../src/renderer/helpers/sponsorblock.js', () => ({
  sponsorBlockSkipSegments: vi.fn(),
}))

const { sponsorBlockSkipSegments } = await import('../../../../src/renderer/helpers/sponsorblock.js')
const {
  deduplicateAudioTracks,
  findMostSimilarAudioBandwidth,
  getSponsorBlockSegments,
  hlsProxiedUrlReplacer,
  logShakaError,
  manifestPreprocessorTXml,
  patchLiveHlsMainManifest,
  repairInvidiousManifest,
  registerSabrReload,
  requestFilter,
  sortCaptions,
  translateSponsorBlockCategory,
} = await import('../../../../src/renderer/helpers/player/utils.js')

/** Minimal shaka tXml node builder */
function node(tagName, attributes = {}, children = []) {
  const n = { tagName, attributes, children, parent: null }
  for (const child of children) {
    if (typeof child !== 'string') child.parent = n
  }
  return n
}

describe('translateSponsorBlockCategory', () => {
  it.each([
    ['sponsor', 'sponsor'],
    ['selfpromo', 'self-promotion'],
    ['music_offtopic', 'music offtopic'],
    ['filler', 'filler'],
  ])('maps %s to its locale key', (category, key) => {
    expect(translateSponsorBlockCategory(category)).toBe(`t:Video.Sponsor Block category.${key}`)
  })

  it('returns unknown categories unchanged and logs', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(translateSponsorBlockCategory('preview')).toBe('preview')
    expect(error).toHaveBeenCalled()
  })
})

describe('getSponsorBlockSegments', () => {
  it('maps, sorts by start time and averages the reported video duration', async () => {
    sponsorBlockSkipSegments.mockResolvedValue([
      { category: 'outro', segment: [90, 100], UUID: 'b', videoDuration: 100 },
      { category: 'sponsor', segment: [10, 20], UUID: 'a', videoDuration: 102 },
    ])

    const result = await getSponsorBlockSegments('vid', ['sponsor', 'outro'])

    expect(sponsorBlockSkipSegments).toHaveBeenCalledWith('vid', ['sponsor', 'outro'])
    expect(result).toEqual({
      averageDuration: 101,
      segments: [
        { uuid: 'a', category: 'sponsor', startTime: 10, endTime: 20 },
        { uuid: 'b', category: 'outro', startTime: 90, endTime: 100 },
      ],
    })
  })

  it('returns an empty result without dividing by zero', async () => {
    sponsorBlockSkipSegments.mockResolvedValue([])
    expect(await getSponsorBlockSegments('vid', [])).toEqual({ segments: [], averageDuration: 0 })
  })
})

describe('sortCaptions', () => {
  beforeEach(() => {
    i18nState.locale.value = 'en-US'
  })

  const caption = (language, label, isAutotranslated = false) => ({ url: '', mimeType: 'text/vtt', language, label, isAutotranslated })

  it('puts the display language first, preferring manual, matching-region captions', () => {
    const sorted = sortCaptions([
      caption('de', 'German'),
      caption('en', 'English (auto-generated)'),
      caption('en-GB', 'English (United Kingdom)'),
      caption('en-US', 'English (United States)'),
      caption('fr', 'French'),
      caption('en', 'English'),
    ])

    expect(sorted.map(c => c.label)).toEqual([
      // region match, then no region, then wrong region, auto-generated last
      'English (United States)',
      'English',
      'English (United Kingdom)',
      'English (auto-generated)',
      // other languages alphabetically
      'French',
      'German',
    ])
  })

  it('ranks auto-translated captions below manual ones of the same language', () => {
    const sorted = sortCaptions([
      caption('en', 'English (translated)', true),
      caption('en', 'English'),
    ])
    expect(sorted.map(c => c.label)).toEqual(['English', 'English (translated)'])
  })

  it('uses the current locale', () => {
    i18nState.locale.value = 'fr-FR'
    const sorted = sortCaptions([caption('en', 'English'), caption('fr', 'Français')])
    expect(sorted[0].language).toBe('fr')
  })
})

describe('repairInvidiousManifest', () => {
  function audioSet(url, extra = {}) {
    return node('AdaptationSet', { mimeType: 'audio/webm', label: '160k', ...extra }, [
      node('Role', { schemeIdUri: 'urn:mpeg:dash:role:2011', value: 'main' }),
      node('Representation', { id: '251' }, [node('BaseURL', {}, [url])]),
    ])
  }

  it('drops bitrate labels and bogus roles, then derives language/role/label from xtags', () => {
    const original = audioSet('https://rr.googlevideo.com/videoplayback?itag=251&amp;xtags=acont%3Doriginal%3Alang%3Den')
    const dubbed = audioSet('https://rr.googlevideo.com/videoplayback?itag=251&xtags=acont%3Ddubbed%3Alang%3Dde')
    const descriptive = audioSet('https://rr.googlevideo.com/videoplayback?itag=251&xtags=acont%3Ddescriptive%3Alang%3Den')
    const video = node('AdaptationSet', { mimeType: 'video/mp4', label: 'keep' }, [])

    repairInvidiousManifest([node('Period', {}, [original, dubbed, descriptive, video])])

    const role = (set) => set.children.filter(c => c.tagName === 'Role').map(c => c.attributes.value)

    expect(original.attributes).toMatchObject({ lang: 'en', label: 'English original' })
    expect(role(original)).toEqual(['main'])

    expect(dubbed.attributes).toMatchObject({ lang: 'de', label: 'German' })
    expect(role(dubbed)).toEqual(['dub'])

    expect(descriptive.attributes.label).toBe('English descriptive')
    expect(role(descriptive)).toEqual(['description'])

    // non-audio sets are untouched
    expect(video.attributes.label).toBe('keep')
  })

  it('leaves the set unlabelled when the URL has no xtags', () => {
    const set = audioSet('https://rr.googlevideo.com/videoplayback?itag=251')
    repairInvidiousManifest([node('Period', {}, [set])])
    expect(set.attributes.label).toBeUndefined()
    expect(set.attributes.lang).toBeUndefined()
    expect(set.children.some(c => c.tagName === 'Role')).toBe(false)
  })
})

describe('findMostSimilarAudioBandwidth', () => {
  it('returns the variant with the closest audio bandwidth', () => {
    const variants = [{ id: 1, audioBandwidth: 50000 }, { id: 2, audioBandwidth: 130000 }, { id: 3, audioBandwidth: 160000 }]
    expect(findMostSimilarAudioBandwidth(variants, 140000).id).toBe(2)
    expect(findMostSimilarAudioBandwidth(variants, 1000000).id).toBe(3)
  })

  it('returns undefined for no variants', () => {
    expect(findMostSimilarAudioBandwidth([], 1)).toBeUndefined()
  })
})

describe('deduplicateAudioTracks', () => {
  it('keys tracks by label, language, channels and spatial audio, preferring the active one', () => {
    const tracks = [
      { label: 'English', language: 'en', channelsCount: 2, spatialAudio: false, active: false, n: 1 },
      { label: 'English', language: 'en', channelsCount: 2, spatialAudio: false, active: true, n: 2 },
      { label: 'English', language: 'en', channelsCount: 2, spatialAudio: false, active: false, n: 3 },
      { label: 'English', language: 'en', channelsCount: 6, spatialAudio: false, active: false, n: 4 },
    ]
    const result = deduplicateAudioTracks(tracks)
    expect([...result.values()].map(t => t.n)).toEqual([2, 4])
  })
})

describe('patchLiveHlsMainManifest', () => {
  const encode = (text) => new TextEncoder().encode(text)
  const decode = (data) => new TextDecoder().decode(data)

  const format140 = {
    itag: 140,
    mime_type: 'audio/mp4; codecs="mp4a.40.2"',
    audio_sample_rate: 44100,
    audio_channels: 2,
    language: 'en',
    is_original: true,
    is_auto_dubbed: false,
    audio_track: { display_name: 'English "original"' },
  }

  it('adds an EXT-X-MEDIA audio group per matched itag and links the streams to it', () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000,CODECS="avc1.4d401f,mp4a.40.2"',
      'https://manifest.googlevideo.com/api/manifest/hls_playlist/sgoap/itag%3D140/sgovp/itag%3D134/file/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=500,CODECS="avc1.4d4015,mp4a.40.5"',
      'https://manifest.googlevideo.com/api/manifest/hls_playlist/sgoap/itag%3D139/sgovp/itag%3D133/file/index.m3u8',
    ].join('\n')

    const lines = decode(patchLiveHlsMainManifest(encode(manifest), [format140])).split('\n')

    expect(lines[1]).toBe('#EXT-X-VERSION:7')
    const media = lines.filter(l => l.startsWith('#EXT-X-MEDIA:'))
    expect(media).toHaveLength(2)
    // double quotes are not allowed in HLS quoted strings
    expect(media[0]).toBe('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="mp4a-2-44100",NAME="English original",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,CHANNELS=2,SAMPLE-RATE=44100')
    // itag 139 borrows itag 140's metadata but with half the sample rate
    expect(media[1]).toContain('GROUP-ID="mp4a-2-22050"')
    expect(media[1]).toContain('SAMPLE-RATE=22050')

    const streams = lines.filter(l => l.startsWith('#EXT-X-STREAM-INF:'))
    expect(streams[0].endsWith(',AUDIO=mp4a-2-44100')).toBe(true)
    expect(streams[1].endsWith(',AUDIO=mp4a-2-22050')).toBe(true)
    // media lines go before the first stream
    expect(lines.indexOf(media[0])).toBeLessThan(lines.indexOf(streams[0]))
  })

  it('returns the original data when no audio itag matches', () => {
    const data = encode('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://x/sgoap/itag%3D999/file/index.m3u8\n')
    expect(patchLiveHlsMainManifest(data, [format140])).toBe(data)
  })

  it('falls back to a language name, then "Untitled", and "und" for missing languages', () => {
    const manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://x/sgoap/itag%3D251/file/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\nhttps://x/sgoap/itag%3D250/file/index.m3u8'
    const formats = [
      { itag: 251, mime_type: 'audio/webm; codecs="opus"', audio_sample_rate: 48000, audio_channels: 2, language: 'de', is_original: false, is_auto_dubbed: true },
      { itag: 250, mime_type: 'audio/webm; codecs="opus"', audio_sample_rate: 48000, audio_channels: 1, is_original: false, is_auto_dubbed: false },
    ]
    const media = decode(patchLiveHlsMainManifest(encode(manifest), formats)).split('\n').filter(l => l.startsWith('#EXT-X-MEDIA:'))
    expect(media[0]).toContain('NAME="German",LANGUAGE="de",DEFAULT=NO,AUTOSELECT=NO')
    expect(media[1]).toContain('NAME="Untitled",LANGUAGE="und"')
  })
})

describe('hlsProxiedUrlReplacer', () => {
  it('moves query params into the path, adds a googlevideo host and ends with the file', () => {
    const result = hlsProxiedUrlReplacer('https://inv.example/videoplayback?file=seg.ts&hls_chunk_host=r1---sn-abc.c.youtube.com&itag=93')
    expect(result).toBe(
      'https://inv.example/videoplayback' +
      '/host/r1---sn-abc.googlevideo.com' +
      '/hls_chunk_host/r1---sn-abc.c.youtube.com' +
      '/itag/93' +
      '/file/seg.ts'
    )
  })
})

describe('manifestPreprocessorTXml', () => {
  it('orders adaptation sets by codec preference, text last, and audio representations by bandwidth', () => {
    const avc = node('AdaptationSet', { mimeType: 'video/mp4', codecs: 'avc1.640028' })
    const text = node('AdaptationSet', { mimeType: 'text/vtt' })
    const vp9 = node('AdaptationSet', { mimeType: 'video/webm' }, [node('Representation', { codecs: 'vp9', bandwidth: 1 })])
    const audio = node('AdaptationSet', { mimeType: 'audio/webm', codecs: 'opus' }, [
      node('Representation', { bandwidth: 50000 }),
      node('AudioChannelConfiguration', {}),
      node('Representation', { bandwidth: 160000 }),
    ])
    const period = node('Period', {}, [avc, text, vp9, audio])
    const mpd = node('MPD', { type: 'static' }, [period])

    manifestPreprocessorTXml(mpd)

    expect(period.children).toEqual([audio, vp9, avc, text])
    expect(audio.children.map(c => c.attributes.bandwidth ?? c.tagName)).toEqual(['AudioChannelConfiguration', 160000, 50000])
  })

  it('does not run the Invidious repair when the local API is supported', () => {
    const audio = node('AdaptationSet', { mimeType: 'audio/webm', codecs: 'opus', label: '160k' }, [])
    manifestPreprocessorTXml(node('MPD', { type: 'static' }, [node('Period', {}, [audio])]))
    expect(audio.attributes.label).toBe('160k')
  })

  it('for live manifests doubles the update period as delay and de-duplicates representation ids', () => {
    const repA = node('Representation', { id: 'en' })
    const repB = node('Representation', { id: 'en' })
    const repC = node('Representation', { id: 'en' })
    const period = node('Period', {}, [
      node('AdaptationSet', { mimeType: 'text/vtt' }, [repA]),
      node('AdaptationSet', { mimeType: 'text/vtt' }, [repB, repC]),
    ])
    const mpd = node('MPD', { type: 'dynamic', minimumUpdatePeriod: 'PT5.000S' }, [period])

    manifestPreprocessorTXml(mpd)

    expect(mpd.attributes.suggestedPresentationDelay).toBe('PT10.000S')
    expect([repA, repB, repC].map(r => r.attributes.id)).toEqual(['en', 'en-ft-fix-0', 'en-ft-fix-1'])
  })
})

describe('requestFilter', () => {
  const SEGMENT = shaka.net.NetworkingEngine.RequestType.SEGMENT
  const MANIFEST = shaka.net.NetworkingEngine.RequestType.MANIFEST

  it('turns googlevideo segment GETs into POSTs with the range in the URL', () => {
    const request = {
      uris: ['https://rr1.googlevideo.com/videoplayback?itag=251'],
      method: 'GET',
      headers: { Range: 'bytes=0-999' },
    }

    requestFilter(SEGMENT, request)

    expect(request.method).toBe('POST')
    expect([...request.body]).toEqual([0x78, 0])
    expect(request.uris[0]).toBe('https://rr1.googlevideo.com/videoplayback?itag=251&range=0-999&alr=yes')
    expect(request.headers.Range).toBeUndefined()
  })

  it.each([
    ['non-googlevideo hosts', SEGMENT, 'https://inv.example/videoplayback?itag=251'],
    ['other googlevideo paths', SEGMENT, 'https://rr1.googlevideo.com/initplayback'],
    ['non-segment requests', MANIFEST, 'https://rr1.googlevideo.com/videoplayback'],
  ])('leaves %s alone', (_, type, uri) => {
    const request = { uris: [uri], method: 'GET', headers: { Range: 'bytes=0-1' } }
    requestFilter(type, request)
    expect(request).toEqual({ uris: [uri], method: 'GET', headers: { Range: 'bytes=0-1' } })
  })
})

describe('logShakaError', () => {
  it('names the severity, category and code and appends data and details', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { Severity, Category, Code } = shaka.util.Error
    const error = new shaka.util.Error(Severity.CRITICAL, Category.MEDIA, Code.MP4_SIDX_WRONG_BOX_TYPE, 'extra')

    logShakaError(error, 'ctx', 'vid123', { a: 1 })

    const [message, ...rest] = spy.mock.calls[0]
    expect(message).toContain('Video ID: "vid123"')
    expect(message).toContain('FreeTube player context: "ctx"')
    expect(message).toContain(`Severity: CRITICAL (${Severity.CRITICAL})`)
    expect(message).toContain(`Category: MEDIA (${Category.MEDIA})`)
    expect(message).toContain(`Code: MP4_SIDX_WRONG_BOX_TYPE (${Code.MP4_SIDX_WRONG_BOX_TYPE})`)
    expect(rest).toEqual(['\n\nshaka-player Data:', '["extra"]', '\n\nFreeTube data:', '{"a":1}'])
  })
})

describe('registerSabrReload', () => {
  it('allows two reloads of a video, then refuses', () => {
    let result = registerSabrReload(null, 'abc', 0)
    expect(result.allowed).toBe(true)
    result = registerSabrReload(result.state, 'abc', 10_000)
    expect(result.allowed).toBe(true)
    result = registerSabrReload(result.state, 'abc', 20_000)
    expect(result.allowed).toBe(false)
    // Still refused while the attempts keep coming
    expect(registerSabrReload(result.state, 'abc', 60_000).allowed).toBe(false)
  })

  it('starts over for another video or after five quiet minutes', () => {
    const exhausted = { videoId: 'abc', count: 2, lastReloadAt: 0 }
    expect(registerSabrReload(exhausted, 'xyz', 1000).allowed).toBe(true)
    expect(registerSabrReload(exhausted, 'abc', 5 * 60_000 + 1).allowed).toBe(true)
  })
})
