import { beforeAll, describe, expect, it, vi } from 'vitest'
import shaka from 'shaka-player'

import { buildSidx, buildWebmCues, buildWebmInit, concat } from './fixtures/binary.js'

// The parser class is private; the module only registers a factory with shaka.
// Capture that factory by intercepting the registration during import.
let createParser
let MANIFEST_TYPE_SABR

beforeAll(async () => {
  const register = vi.spyOn(shaka.media.ManifestParser, 'registerParserByMime')
  const module = await import('../../../../src/renderer/helpers/player/SabrManifestParser.js')
  MANIFEST_TYPE_SABR = module.MANIFEST_TYPE_SABR
  const call = register.mock.calls.find(([mime]) => mime === MANIFEST_TYPE_SABR)
  createParser = call[1]
  register.mockRestore()
})

function audioFormat(overrides = {}) {
  return {
    itag: 251,
    lastModified: '1700000000',
    mimeType: 'audio/webm; codecs="opus"',
    bitrate: 140000,
    initRange: { start: 0, end: 9 },
    indexRange: { start: 10, end: 19 },
    quality: 'tiny',
    audioSampleRate: 48000,
    audioChannels: 2,
    spatialAudio: false,
    ...overrides,
  }
}

function videoFormat(overrides = {}) {
  return {
    itag: 137,
    lastModified: '1700000001',
    mimeType: 'video/mp4; codecs="avc1.640028"',
    bitrate: 4000000,
    initRange: { start: 0, end: 9 },
    indexRange: { start: 10, end: 19 },
    width: 1920,
    height: 1080,
    frameRate: 30,
    quality: 'hd1080',
    spatialAudio: false,
    ...overrides,
  }
}

function manifestUri(data) {
  return `data:${MANIFEST_TYPE_SABR},${encodeURIComponent(JSON.stringify({
    duration: 60,
    formats: [],
    captions: [],
    storyboards: [],
    chapters: [],
    ...data,
  }))}`
}

async function parse(data, { disableVideo = false, networkingEngine = null } = {}) {
  const parser = createParser()
  parser.configure({ disableVideo })
  const filter = vi.fn(async () => {})
  const manifest = await parser.start(manifestUri(data), { filter, networkingEngine })
  expect(filter).toHaveBeenCalledWith(manifest)
  return manifest
}

describe('SabrManifestParser', () => {
  it('registers itself for the SABR mime type', () => {
    expect(MANIFEST_TYPE_SABR).toBe('application/sabr+json')
    expect(typeof createParser).toBe('function')
  })

  it('crosses every audio stream with every video stream', async () => {
    const manifest = await parse({
      formats: [
        audioFormat({ itag: 251, bitrate: 140000 }),
        audioFormat({ itag: 250, bitrate: 70000 }),
        videoFormat({ itag: 137, mimeType: 'video/mp4; codecs="avc1.640028"' }),
        videoFormat({ itag: 248, mimeType: 'video/webm; codecs="vp9"' }),
        videoFormat({ itag: 399, mimeType: 'video/mp4; codecs="av01.0.08M.08"' }),
      ],
    })

    expect(manifest.type).toBe('SABR')
    expect(manifest.presentationTimeline.getDuration()).toBe(60)
    expect(manifest.variants).toHaveLength(6)

    // audio sorted by bandwidth (desc), video by codec preference av01 > vp9 > avc1
    expect(manifest.variants.map(v => [v.audio.originalId.split('-')[0], v.video.originalId.split('-')[0]])).toEqual([
      ['251', '399'], ['251', '248'], ['251', '137'],
      ['250', '399'], ['250', '248'], ['250', '137'],
    ])
    expect(manifest.variants[0].bandwidth).toBe(140000 + 4000000)
    expect(new Set(manifest.variants.map(v => v.id)).size).toBe(6)
  })

  it('builds format ids from itag, last modified and xtags', async () => {
    const manifest = await parse({
      formats: [audioFormat({ itag: 140, lastModified: undefined, xtags: 'abc', mimeType: 'audio/mp4; codecs="mp4a.40.2"' }), videoFormat()],
    })
    expect(manifest.variants[0].audio.originalId).toBe('140-0-abc')
    expect(manifest.variants[0].video.originalId).toBe('137-1700000001-')
  })

  it('maps audio metadata, codecs and defaults', async () => {
    const manifest = await parse({ formats: [audioFormat(), videoFormat()] })
    const { audio, video } = manifest.variants[0]

    expect(audio).toMatchObject({
      type: 'audio',
      mimeType: 'audio/webm',
      codecs: 'opus',
      bandwidth: 140000,
      audioSamplingRate: 48000,
      channelsCount: 2,
      language: 'und',
      originalLanguage: null,
      label: null,
      roles: [],
      primary: false,
    })
    expect(video).toMatchObject({
      type: 'video',
      mimeType: 'video/mp4',
      codecs: 'avc1.640028',
      width: 1920,
      height: 1080,
      frameRate: 30,
      hdr: 'SDR',
      colorGamut: 'srgb',
    })
  })

  it('assigns roles and labels for original, dubbed and DRC audio', async () => {
    const manifest = await parse({
      formats: [
        audioFormat({ itag: 1, bitrate: 3, language: 'en', isOriginal: true }),
        audioFormat({ itag: 2, bitrate: 2, language: 'en', isOriginal: true, isDrc: true }),
        audioFormat({ itag: 3, bitrate: 1, language: 'de', isDubbed: true, label: 'German' }),
        videoFormat(),
      ],
    }, { disableVideo: true })

    const byItag = Object.fromEntries(manifest.variants.map(v => [v.audio.originalId.split('-')[0], v.audio]))

    expect(byItag[1]).toMatchObject({ roles: ['main'], primary: true, label: 'Original', language: 'en' })
    // DRC takes precedence over the original role
    expect(byItag[2]).toMatchObject({ roles: ['drc'], primary: false, label: 'Stable Volume' })
    expect(byItag[3]).toMatchObject({ roles: ['dubbed'], label: 'German', language: 'de' })
  })

  it('suffixes explicit labels for DRC and voice boost', async () => {
    const manifest = await parse({
      formats: [
        audioFormat({ itag: 1, bitrate: 2, label: 'English', isDrc: true }),
        audioFormat({ itag: 2, bitrate: 1, label: 'English', isVoiceBoost: true }),
        videoFormat(),
      ],
    }, { disableVideo: true })

    expect(manifest.variants.map(v => [v.audio.label, v.audio.roles])).toEqual([
      ['English (Stable Volume)', ['drc']],
      ['English (Voice Boost)', ['voice-boost']],
    ])
  })

  it('skips the CgcKAnZiEgEx xtags audio format', async () => {
    const manifest = await parse({
      formats: [audioFormat({ itag: 251, xtags: 'CgcKAnZiEgEx' }), audioFormat({ itag: 250 }), videoFormat()],
    }, { disableVideo: true })
    expect(manifest.variants.map(v => v.audio.originalId.split('-')[0])).toEqual(['250'])
  })

  it('tags HDR video by transfer characteristics and gamut', async () => {
    const manifest = await parse({
      formats: [
        audioFormat(),
        videoFormat({ itag: 1, colorTransferCharacteristics: 'SMPTEST2084', colorPrimaries: 'BT2020' }),
        videoFormat({ itag: 2, colorTransferCharacteristics: 'ARIB_STD_B67', colorPrimaries: 'BT2020' }),
      ],
    })
    expect(manifest.variants.map(v => [v.video.hdr, v.video.colorGamut])).toEqual([['PQ', 'rec2020'], ['HLG', 'rec2020']])
  })

  it('produces audio-only variants when video is disabled', async () => {
    const manifest = await parse({ formats: [audioFormat(), videoFormat()] }, { disableVideo: true })
    expect(manifest.variants).toHaveLength(1)
    expect(manifest.variants[0].video).toBeNull()
  })

  it('creates caption, storyboard and chapter streams with unique ids', async () => {
    const manifest = await parse({
      formats: [audioFormat(), videoFormat()],
      captions: [{ id: 'en', label: 'English', mimeType: 'text/vtt', language: 'en', url: 'https://example.com/en.vtt' }],
      storyboards: [{
        templateUrl: 'https://example.com/sb/M$M.jpg',
        mimeType: 'image/jpeg',
        columns: 5,
        rows: 5,
        thumbnailCount: 100,
        thumbnailWidth: 160,
        thumbnailHeight: 90,
        storyboardCount: 3,
        interval: 0,
      }],
      chapters: [
        { title: 'Intro', startSeconds: 0, endSeconds: 10 },
        { title: 'Main', startSeconds: 10, endSeconds: 60, thumbnail: { url: 'https://example.com/c.jpg', width: 1, height: 2 } },
      ],
    })

    const ids = [
      manifest.variants[0].audio.id,
      manifest.variants[0].video.id,
      ...manifest.textStreams.map(s => s.id),
      ...manifest.imageStreams.map(s => s.id),
      ...manifest.chapterStreams.map(s => s.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)

    const [text] = manifest.textStreams
    expect(text).toMatchObject({ type: 'text', language: 'en', label: 'English', kind: 'captions' })
    await text.createSegmentIndex()
    const textRef = text.segmentIndex.get(0)
    expect([textRef.getStartTime(), textRef.getEndTime(), textRef.getUris()]).toEqual([0, 60, ['https://example.com/en.vtt']])

    const [image] = manifest.imageStreams
    expect(image).toMatchObject({ type: 'image', tilesLayout: '5x5', width: 800, height: 450 })
    await image.createSegmentIndex()
    // interval 0 => duration / thumbnailCount = 0.6s per tile, 15s per 5x5 sheet
    const sheets = [0, 1, 2].map(i => image.segmentIndex.get(i))
    expect(sheets.map(r => [r.getStartTime(), r.getEndTime()])).toEqual([[0, 15], [15, 30], [30, 45]])
    expect(sheets[2].getUris()).toEqual(['https://example.com/sb/M2.jpg'])

    const [chapters] = manifest.chapterStreams
    expect(chapters.type).toBe('chapter')
    const chapterRefs = [0, 1].map(i => chapters.segmentIndex.get(i))
    expect(chapterRefs.map(r => [r.getStartTime(), r.getEndTime(), r.getMetadata().title])).toEqual([[0, 10, 'Intro'], [10, 60, 'Main']])
    expect(chapterRefs[1].getMetadata().images).toEqual([{ url: 'https://example.com/c.jpg', width: 1, height: 2 }])
  })

  it('returns no chapter stream without chapters', async () => {
    const manifest = await parse({ formats: [audioFormat(), videoFormat()] })
    expect(manifest.chapterStreams).toEqual([])
  })

  // Suspected bug: in audio-only mode the parser picks the worst video format to use
  // as a fake videoFormatId, but when the manifest has no video formats the reduce
  // returns null and buildFormatId(null) throws (SabrManifestParser.js:169 -> :291).
  // It should still produce audio-only variants (without a fake video format id).
  it.fails('handles audio-only mode when the manifest has no video formats', async () => {
    const manifest = await parse({ formats: [audioFormat()] }, { disableVideo: true })
    expect(manifest.variants).toHaveLength(1)
  })

  describe('segment indexes', () => {
    function fakeNetworkingEngine(data) {
      return {
        request: vi.fn(() => ({ promise: Promise.resolve({ data }) })),
      }
    }

    it('requests the init segment over sabr: and parses a WebM Cues index', async () => {
      const { data: init } = buildWebmInit({ duration: 60000 })
      const cues = buildWebmCues([{ time: 0, clusterPosition: 0 }, { time: 30000, clusterPosition: 1000 }])
      const body = concat(init, cues)
      const engine = fakeNetworkingEngine(body)

      const format = audioFormat({
        isDrc: true,
        initRange: { start: 0, end: init.length - 1 },
        indexRange: { start: init.length, end: body.length - 1 },
      })
      // add a video format so a fake video format id is attached in audio-only mode
      const manifest = await parse({ formats: [format, videoFormat({ itag: 160, bitrate: 1 }), videoFormat({ itag: 137, bitrate: 9 })] }, { disableVideo: true, networkingEngine: engine })

      const { audio } = manifest.variants[0]
      await audio.createSegmentIndex()

      const request = engine.request.mock.calls[0][1]
      expect(request.uris[0]).toBe(
        `sabr:audio?formatId=${encodeURIComponent(audio.originalId)}&videoFormatId=${encodeURIComponent('160-1700000001-')}&drc&init`
      )

      const refs = [0, 1].map(i => audio.segmentIndex.get(i))
      expect(refs.map(r => [r.getStartTime(), r.getEndTime()])).toEqual([[0, 30], [30, 60]])
      expect(refs[0].mimeType).toBe('audio/webm')
      expect(refs[0].codecs).toBe('opus')

      // calling again must not re-request
      await audio.createSegmentIndex()
      expect(engine.request).toHaveBeenCalledTimes(1)

      audio.closeSegmentIndex()
      expect(audio.segmentIndex).toBeNull()
    })

    it('parses an MP4 sidx index and includes the resolution for video', async () => {
      const init = new Uint8Array(32)
      const sidx = buildSidx({ timescale: 1000, references: [{ size: 100, duration: 20000 }, { size: 100, duration: 40000 }] })
      const engine = fakeNetworkingEngine(concat(init, sidx))

      const format = videoFormat({
        height: 720,
        initRange: { start: 0, end: 31 },
        indexRange: { start: 32, end: 32 + sidx.length - 1 },
      })
      const manifest = await parse({ formats: [audioFormat(), format] }, { networkingEngine: engine })

      const { video } = manifest.variants[0]
      await video.createSegmentIndex()

      expect(engine.request.mock.calls[0][1].uris[0]).toBe(`sabr:video?formatId=${encodeURIComponent(video.originalId)}&resolution=720&init`)
      const refs = [0, 1].map(i => video.segmentIndex.get(i))
      // sidx byte ranges are relative to the index range start
      expect(refs.map(r => [r.getStartByte(), r.getEndByte()])).toEqual([[32 + sidx.length, 32 + sidx.length + 99], [32 + sidx.length + 100, 32 + sidx.length + 199]])
      expect(refs[1].getUris()[0]).toContain('&startTimeMs=20000&sq=2')
    })
  })
})
