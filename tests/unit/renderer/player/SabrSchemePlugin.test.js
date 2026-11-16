import { describe, expect, it, vi } from 'vitest'
import shaka from 'shaka-player'

import {
  createBufferedRange,
  excludeRequestedSegment,
  getPolicyRetryDelayMs,
  refreshPoTokenIfRejected,
  waitForReplacementPoToken,
} from '../../../../src/renderer/helpers/player/SabrSchemePlugin.js'

const formatId = { itag: 251, lastModified: '1700000000', xtags: undefined }

// Ten 5-second segments: position p covers [5p, 5p + 5) and has sequence number p + 1
function segmentIndex() {
  const references = []
  for (let i = 0; i < 10; i++) {
    references.push(new shaka.media.SegmentReference(i * 5, (i + 1) * 5, () => [], 0, null, null, 0, 0, Infinity))
  }
  return new shaka.media.SegmentIndex(references)
}

describe('createBufferedRange', () => {
  it('reports 1-based sequence numbers for a range on segment boundaries', () => {
    // Segments 1-3 (positions 0-2) are buffered
    expect(createBufferedRange(formatId, { start: 0, end: 15 }, segmentIndex())).toEqual({
      formatId,
      startTimeMs: '0',
      durationMs: '15000',
      startSegmentIndex: 1,
      endSegmentIndex: 3,
    })
  })

  it('does not claim the partially buffered segment after the range', () => {
    // The buffer ends a little into sq 4: shaka-player will request sq 4,
    // so the server must not be told it is buffered
    const range = createBufferedRange(formatId, { start: 0, end: 15.4 }, segmentIndex())
    expect(range.endSegmentIndex).toBe(3)
  })

  it('does not claim a partially buffered first segment', () => {
    const range = createBufferedRange(formatId, { start: 12, end: 30 }, segmentIndex())
    expect(range.startSegmentIndex).toBe(4)
    expect(range.endSegmentIndex).toBe(6)
    expect(range.startTimeMs).toBe('15000')
  })

  it('tolerates buffered ranges that stop just short of a boundary', () => {
    const range = createBufferedRange(formatId, { start: 0.02, end: 14.97 }, segmentIndex())
    expect(range.startSegmentIndex).toBe(1)
    expect(range.endSegmentIndex).toBe(3)
  })

  it('covers the last segment when the range reaches the end', () => {
    const range = createBufferedRange(formatId, { start: 40, end: 50 }, segmentIndex())
    expect(range.startSegmentIndex).toBe(9)
    expect(range.endSegmentIndex).toBe(10)
  })

  it('returns null when no segment is completely buffered', () => {
    expect(createBufferedRange(formatId, { start: 6, end: 9 }, segmentIndex())).toBeNull()
  })
})

describe('excludeRequestedSegment', () => {
  const ranges = [
    { formatId: { itag: 251 }, startSegmentIndex: 1, endSegmentIndex: 13 },
    { formatId: { itag: 251 }, startSegmentIndex: 20, endSegmentIndex: 25 },
    { formatId: { itag: 399 }, startSegmentIndex: 1, endSegmentIndex: 13 },
  ]

  it('drops the range of the requested format that contains the requested segment', () => {
    expect(excludeRequestedSegment(ranges, 251, 13)).toEqual([ranges[1], ranges[2]])
  })

  it('keeps everything when the requested segment is not claimed', () => {
    expect(excludeRequestedSegment(ranges, 251, 14)).toEqual(ranges)
  })
})

describe('getPolicyRetryDelayMs', () => {
  const state = (retries, backoffTimeMs) => ({
    cumulativeRetryDueToNextRequestPolicy: retries,
    sabrStreamState: { nextRequestPolicy: { backoffTimeMs } },
  })

  it('retries immediately at first', () => {
    expect(getPolicyRetryDelayMs(state(0))).toBe(0)
    expect(getPolicyRetryDelayMs(state(2))).toBe(0)
  })

  it('backs off exponentially after repeated policy-only responses, up to a cap', () => {
    expect(getPolicyRetryDelayMs(state(3))).toBe(100)
    expect(getPolicyRetryDelayMs(state(4))).toBe(200)
    expect(getPolicyRetryDelayMs(state(15))).toBe(2000)
  })

  it('leaves waiting to the server backoff when one is given', () => {
    expect(getPolicyRetryDelayMs(state(10, 500))).toBe(0)
  })
})

describe('PO token refresh', () => {
  // base64 'AQID' is [1, 2, 3], 'BAUG' is [4, 5, 6]
  function tokenState(refreshPoToken) {
    const poToken = new Uint8Array([9])
    return {
      sentPoToken: poToken,
      sabrStreamState: { poToken, refreshPoToken, poTokenRefresh: null, poTokenRefreshes: 0 },
    }
  }

  it('replaces a token the server has not accepted', async () => {
    const state = tokenState(vi.fn(async () => 'AQID'))

    expect(await waitForReplacementPoToken(state)).toBe(true)
    expect([...state.sabrStreamState.poToken]).toEqual([1, 2, 3])
    expect(state.sabrStreamState.refreshPoToken).toHaveBeenCalledTimes(1)
  })

  it('mints only one replacement for concurrent requests carrying the same token', async () => {
    const refresh = vi.fn(async () => 'AQID')
    const video = tokenState(refresh)
    const audio = { sentPoToken: video.sentPoToken, sabrStreamState: video.sabrStreamState }

    refreshPoTokenIfRejected(video)
    refreshPoTokenIfRejected(audio)
    await video.sabrStreamState.poTokenRefresh

    // A late response graded against the old token must not trigger another refresh
    refreshPoTokenIfRejected(audio)

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('stops after three replacements so a session that is never accepted falls back to a reload', async () => {
    const tokens = ['AQID', 'BAUG', 'AQID']
    const state = tokenState(vi.fn(async () => tokens.shift()))

    for (let i = 0; i < 3; i++) {
      expect(await waitForReplacementPoToken(state)).toBe(true)
      state.sentPoToken = state.sabrStreamState.poToken
    }

    expect(await waitForReplacementPoToken(state)).toBe(false)
    expect(state.sabrStreamState.refreshPoToken).toHaveBeenCalledTimes(3)
  })

  it('reports no replacement when minting fails or is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = tokenState(vi.fn(async () => { throw new Error('BotGuard failed') }))

    expect(await waitForReplacementPoToken(failing)).toBe(false)
    expect(await waitForReplacementPoToken(tokenState(undefined))).toBe(false)
  })
})
