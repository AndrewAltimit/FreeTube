import { describe, expect, it, vi } from 'vitest'
import shaka from 'shaka-player'

import { parseWebmSegmentIndex } from '../../../../src/renderer/helpers/player/WebmSegmentIndexParser.js'
import { buildWebmCues, buildWebmInit, concat, ebmlElement, ebmlUint, WEBM_IDS } from './fixtures/binary.js'

const { Code } = shaka.util.Error
const URI = 'sabr:audio?formatId=251'

function parse(cues, init, { timestampOffset = 0, appendWindowEnd = 100 } = {}) {
  return parseWebmSegmentIndex(cues, init, URI, null, timestampOffset, 0, appendWindowEnd)
}

function codeOf(fn) {
  try {
    fn()
  } catch (error) {
    return error.code
  }
  return undefined
}

describe('parseWebmSegmentIndex', () => {
  it('builds one reference per cue point, the last ending at the duration', () => {
    // default timecode scale is 1ms, so times/duration are in ms
    const { data: init, segmentOffset } = buildWebmInit({ duration: 6000 })
    const cues = buildWebmCues([
      { time: 0, clusterPosition: 100 },
      { time: 2000, clusterPosition: 600 },
      { time: 4500, clusterPosition: 1500 },
    ])

    const refs = parse(cues, init)

    expect(refs).toHaveLength(3)
    expect(refs.map(r => [r.getStartTime(), r.getEndTime()])).toEqual([[0, 2], [2, 4.5], [4.5, 6]])
    // byte ranges are relative to the Segment payload and contiguous
    expect(refs.map(r => [r.getStartByte(), r.getEndByte()])).toEqual([
      [segmentOffset + 100, segmentOffset + 599],
      [segmentOffset + 600, segmentOffset + 1499],
      [segmentOffset + 1500, null],
    ])
  })

  it('appends the start time in ms and a 1-based sequence number to each URI', () => {
    const { data: init } = buildWebmInit({ duration: 6000 })
    const cues = buildWebmCues([
      { time: 0, clusterPosition: 0 },
      { time: 2000, clusterPosition: 10 },
      { time: 4500, clusterPosition: 20 },
    ])

    const uris = parse(cues, init).map(r => r.getUris()[0])
    expect(uris).toEqual([
      `${URI}&startTimeMs=0&sq=1`,
      `${URI}&startTimeMs=2000&sq=2`,
      `${URI}&startTimeMs=4500&sq=3`,
    ])
  })

  it('honours a custom TimecodeScale', () => {
    // 1e7 ns per tick => 10ms per tick
    const { data: init } = buildWebmInit({ timecodeScale: 10000000, duration: 500 })
    const cues = buildWebmCues([
      { time: 0, clusterPosition: 0 },
      { time: 250, clusterPosition: 10 },
    ])

    const refs = parse(cues, init)
    expect(refs.map(r => [r.getStartTime(), r.getEndTime()])).toEqual([[0, 2.5], [2.5, 5]])
  })

  it('applies the timestamp offset to times and URIs', () => {
    const { data: init } = buildWebmInit({ duration: 4000 })
    const cues = buildWebmCues([
      { time: 0, clusterPosition: 0 },
      { time: 2000, clusterPosition: 10 },
    ])

    const refs = parse(cues, init, { timestampOffset: 10 })
    expect(refs.map(r => [r.getStartTime(), r.getEndTime()])).toEqual([[10, 12], [12, 14]])
    expect(refs[1].getUris()[0]).toBe(`${URI}&startTimeMs=12000&sq=2`)
  })

  it('finds Info after other Segment children and handles an unknown Segment size', () => {
    const tracks = ebmlElement(WEBM_IDS.TRACKS, [0xec, 0x81, 0x00])
    const { data: init, segmentOffset } = buildWebmInit({ duration: 1000, prefix: [tracks], unknownSegmentSize: true })
    const cues = buildWebmCues([{ time: 0, clusterPosition: 42 }])

    const refs = parse(cues, init)
    expect(refs).toHaveLength(1)
    expect(refs[0].getStartByte()).toBe(segmentOffset + 42)
    expect(refs[0].getEndTime()).toBe(1)
  })

  it('skips non-CuePoint children of Cues', () => {
    const { data: init } = buildWebmInit({ duration: 2000 })
    const cuePoints = buildWebmCues([{ time: 0, clusterPosition: 0 }])
    // strip the Cues header (4-byte id + 1-byte size) and re-wrap with a Void element in front
    const cues = ebmlElement(WEBM_IDS.CUES, concat(ebmlElement(WEBM_IDS.VOID, [0]), cuePoints.slice(5)))

    expect(parse(cues, init)).toHaveLength(1)
  })

  it('returns no references when Cues has no cue points', () => {
    const { data: init } = buildWebmInit({ duration: 2000 })
    expect(parse(ebmlElement(WEBM_IDS.CUES, []), init)).toEqual([])
  })

  it('defaults the cluster position to 0 when CueTrackPositions lacks one', () => {
    const { data: init, segmentOffset } = buildWebmInit({ duration: 2000 })
    const cues = ebmlElement(WEBM_IDS.CUES, ebmlElement(WEBM_IDS.CUE_POINT, concat(
      ebmlUint(WEBM_IDS.CUE_TIME, 0),
      ebmlElement(WEBM_IDS.CUE_TRACK_POSITIONS, ebmlUint(WEBM_IDS.CUE_TRACK, 1))
    )))

    expect(parse(cues, init)[0].getStartByte()).toBe(segmentOffset)
  })

  describe('errors', () => {
    it('rejects init data without an EBML header', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const bogus = ebmlUint(WEBM_IDS.CUE_TIME, 0)
      expect(codeOf(() => parse(buildWebmCues([]), bogus))).toBe(Code.WEBM_EBML_HEADER_ELEMENT_MISSING)
    })

    it('rejects init data without a Segment', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const init = concat(ebmlElement(WEBM_IDS.EBML, []), ebmlElement(WEBM_IDS.TRACKS, []))
      expect(codeOf(() => parse(buildWebmCues([]), init))).toBe(Code.WEBM_SEGMENT_ELEMENT_MISSING)
    })

    it('rejects a Segment without Info', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const init = concat(ebmlElement(WEBM_IDS.EBML, []), ebmlElement(WEBM_IDS.SEGMENT, ebmlElement(WEBM_IDS.TRACKS, [])))
      expect(codeOf(() => parse(buildWebmCues([]), init))).toBe(Code.WEBM_INFO_ELEMENT_MISSING)
    })

    it('rejects Info without a Duration', () => {
      const { data: init } = buildWebmInit({ duration: null, timecodeScale: 1000000 })
      expect(codeOf(() => parse(buildWebmCues([]), init))).toBe(Code.WEBM_DURATION_ELEMENT_MISSING)
    })

    it('rejects cues data that is not a Cues element', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const { data: init } = buildWebmInit()
      expect(codeOf(() => parse(ebmlElement(WEBM_IDS.TRACKS, []), init))).toBe(Code.WEBM_CUES_ELEMENT_MISSING)
    })

    it('rejects a CuePoint whose first child is not CueTime', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { data: init } = buildWebmInit()
      const cues = ebmlElement(WEBM_IDS.CUES, ebmlElement(WEBM_IDS.CUE_POINT, ebmlElement(WEBM_IDS.CUE_TRACK_POSITIONS, [])))
      expect(codeOf(() => parse(cues, init))).toBe(Code.WEBM_CUE_TIME_ELEMENT_MISSING)
    })

    it('rejects a CuePoint without CueTrackPositions after CueTime', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { data: init } = buildWebmInit()
      const cues = ebmlElement(WEBM_IDS.CUES, ebmlElement(WEBM_IDS.CUE_POINT, concat(
        ebmlUint(WEBM_IDS.CUE_TIME, 0),
        ebmlUint(WEBM_IDS.CUE_TIME, 1)
      )))
      expect(codeOf(() => parse(cues, init))).toBe(Code.WEBM_CUE_TRACK_POSITIONS_ELEMENT_MISSING)
    })
  })
})
