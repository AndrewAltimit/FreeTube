import { describe, expect, it, vi } from 'vitest'
import shaka from 'shaka-player'

import { parseMp4SegmentIndex } from '../../../../src/renderer/helpers/player/Mp4SegmentIndexParser.js'
import { buildBox, buildSidx } from './fixtures/binary.js'

const { Code } = shaka.util.Error
const URI = 'sabr:video?formatId=137&resolution=1080'

function codeOf(fn) {
  try {
    fn()
  } catch (error) {
    return error.code
  }
  return undefined
}

describe('parseMp4SegmentIndex', () => {
  it('turns a version 0 sidx into contiguous references after the box', () => {
    const sidx = buildSidx({
      timescale: 1000,
      references: [
        { size: 1000, duration: 5000 },
        { size: 2000, duration: 5000 },
        { size: 500, duration: 2500 },
      ],
    })
    const sidxOffset = 700

    const refs = parseMp4SegmentIndex(sidx, sidxOffset, URI, null, 0, 0, 20)

    expect(refs.map(r => [r.getStartTime(), r.getEndTime()])).toEqual([[0, 5], [5, 10], [10, 12.5]])
    const first = sidxOffset + sidx.length
    expect(refs.map(r => [r.getStartByte(), r.getEndByte()])).toEqual([
      [first, first + 999],
      [first + 1000, first + 2999],
      [first + 3000, first + 3499],
    ])
    expect(refs.map(r => r.getUris()[0])).toEqual([
      `${URI}&startTimeMs=0&sq=1`,
      `${URI}&startTimeMs=5000&sq=2`,
      `${URI}&startTimeMs=10000&sq=3`,
    ])
  })

  it('uses the earliest presentation time, first offset and timescale', () => {
    const sidx = buildSidx({
      timescale: 48000,
      earliestPresentationTime: 96000,
      firstOffset: 64,
      references: [{ size: 100, duration: 48000 }],
    })

    const [ref] = parseMp4SegmentIndex(sidx, 0, URI, null, 0, 0, 20)
    expect(ref.getStartTime()).toBe(2)
    expect(ref.getEndTime()).toBe(3)
    expect(ref.getStartByte()).toBe(sidx.length + 64)
  })

  it('reads 64-bit fields in a version 1 sidx', () => {
    const sidx = buildSidx({
      version: 1,
      timescale: 1000,
      earliestPresentationTime: 2 ** 33, // needs more than 32 bits
      firstOffset: 10,
      references: [{ size: 50, duration: 1000 }],
    })

    const [ref] = parseMp4SegmentIndex(sidx, 0, URI, null, 0, 0, Infinity)
    expect(ref.getStartTime()).toBe(2 ** 33 / 1000)
    expect(ref.getStartByte()).toBe(sidx.length + 10)
  })

  it('applies the timestamp offset to times and URIs', () => {
    const sidx = buildSidx({ timescale: 1, references: [{ size: 10, duration: 4 }] })
    const [ref] = parseMp4SegmentIndex(sidx, 0, URI, null, 1.5, 0, 20)
    expect([ref.getStartTime(), ref.getEndTime()]).toEqual([1.5, 5.5])
    expect(ref.getUris()[0]).toBe(`${URI}&startTimeMs=1500&sq=1`)
  })

  it('finds the sidx after other top-level boxes', () => {
    const data = new Uint8Array([...buildBox('free', [1, 2, 3]), ...buildSidx({ timescale: 1, references: [{ size: 1, duration: 1 }] })])
    expect(parseMp4SegmentIndex(data, 0, URI, null, 0, 0, 20)).toHaveLength(1)
  })

  it('returns no references for a sidx with a zero reference count', () => {
    const sidx = buildSidx({ timescale: 1, references: [] })
    expect(parseMp4SegmentIndex(sidx, 0, URI, null, 0, 0, 20)).toEqual([])
  })

  describe('errors', () => {
    it('rejects data without a sidx box', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(codeOf(() => parseMp4SegmentIndex(buildBox('moof'), 0, URI, null, 0, 0, 20))).toBe(Code.MP4_SIDX_WRONG_BOX_TYPE)
    })

    it('rejects missing data', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(codeOf(() => parseMp4SegmentIndex(null, 0, URI, null, 0, 0, 20))).toBe(Code.MP4_SIDX_WRONG_BOX_TYPE)
    })

    it('rejects a zero timescale', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const sidx = buildSidx({ timescale: 0, references: [{ size: 1, duration: 1 }] })
      expect(codeOf(() => parseMp4SegmentIndex(sidx, 0, URI, null, 0, 0, 20))).toBe(Code.MP4_SIDX_INVALID_TIMESCALE)
    })

    it('rejects hierarchical sidx references', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const sidx = buildSidx({ timescale: 1, references: [{ size: 1, duration: 1, type: 1 }] })
      expect(codeOf(() => parseMp4SegmentIndex(sidx, 0, URI, null, 0, 0, 20))).toBe(Code.MP4_SIDX_TYPE_NOT_SUPPORTED)
    })
  })
})
