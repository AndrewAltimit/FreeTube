import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deArrowData, deArrowThumbnail, sponsorBlockSkipSegments } from '../../../../src/renderer/helpers/sponsorblock.js'

vi.mock('../../../../src/renderer/store/index', () => ({
  default: {
    getters: {
      getSponsorBlockUrl: 'https://sb.example',
      getDeArrowThumbnailGeneratorUrl: 'https://thumb.example',
    },
  },
}))

const VIDEO_ID = 'dQw4w9WgXcQ'

async function hashPrefix(videoId) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(videoId)))
  return Array.from(hash.slice(0, 2), b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * @param {{ status?: number, ok?: boolean, json?: any, text?: string, url?: string }} init
 */
function mockResponse({ status = 200, ok = status >= 200 && status < 300, json, text = '', url = '' }) {
  return {
    status,
    ok,
    url,
    json: vi.fn(async () => json),
    text: vi.fn(async () => text),
  }
}

let fetchMock

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  return () => vi.unstubAllGlobals()
})

describe('sponsorBlockSkipSegments', () => {
  it('requests by 4-char SHA-256 prefix and categories (k-anonymity)', async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: [] }))

    await sponsorBlockSkipSegments(VIDEO_ID, ['sponsor', 'intro'])

    const prefix = await hashPrefix(VIDEO_ID)
    expect(prefix).toMatch(/^[\da-f]{4}$/)
    expect(fetchMock).toHaveBeenCalledWith(`https://sb.example/api/skipSegments/${prefix}?categories=["sponsor","intro"]`)
    expect(fetchMock.mock.calls[0][0]).not.toContain(VIDEO_ID)
  })

  it('returns only segments for the requested video', async () => {
    const mine = [{ UUID: '1', segment: [0, 10] }, { UUID: '2', segment: [20, 30] }]
    fetchMock.mockResolvedValue(mockResponse({
      json: [
        { videoID: 'otherVideo1', segments: [{ UUID: 'x', segment: [1, 2] }] },
        { videoID: VIDEO_ID, segments: mine },
      ],
    }))

    expect(await sponsorBlockSkipSegments(VIDEO_ID, ['sponsor'])).toEqual(mine)
  })

  it('returns an empty list when the hash prefix matches no requested video', async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: [{ videoID: 'otherVideo1', segments: [{}] }] }))

    expect(await sponsorBlockSkipSegments(VIDEO_ID, ['sponsor'])).toEqual([])
  })

  it('returns an empty list on 404', async () => {
    const response = mockResponse({ status: 404 })
    fetchMock.mockResolvedValue(response)

    expect(await sponsorBlockSkipSegments(VIDEO_ID, ['sponsor'])).toEqual([])
    expect(response.json).not.toHaveBeenCalled()
  })

  it('throws the response body on other HTTP errors', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 502, text: 'Bad Gateway' }))

    await expect(sponsorBlockSkipSegments(VIDEO_ID, ['sponsor'])).rejects.toThrow('Bad Gateway')
    expect(console.error).toHaveBeenCalled()
  })

  it('rethrows network errors', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(sponsorBlockSkipSegments(VIDEO_ID, ['sponsor'])).rejects.toThrow('Failed to fetch')
  })
})

describe('deArrowData', () => {
  it('requests branding by hash prefix and picks the matching video', async () => {
    const branding = { titles: [{ title: 'Better title' }], thumbnails: [] }
    fetchMock.mockResolvedValue(mockResponse({ json: { [VIDEO_ID]: branding, otherVideo1: {} } }))

    expect(await deArrowData(VIDEO_ID)).toBe(branding)
    expect(fetchMock).toHaveBeenCalledWith(`https://sb.example/api/branding/${await hashPrefix(VIDEO_ID)}`)
  })

  it('returns undefined when the video is not in the response', async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: { otherVideo1: {} } }))

    expect(await deArrowData(VIDEO_ID)).toBeUndefined()
  })

  it('returns undefined on 404', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 404 }))

    expect(await deArrowData(VIDEO_ID)).toBeUndefined()
  })

  it('rethrows when the body is not JSON', async () => {
    const response = mockResponse({ status: 500 })
    response.json.mockRejectedValue(new SyntaxError('Unexpected token'))
    fetchMock.mockResolvedValue(response)

    await expect(deArrowData(VIDEO_ID)).rejects.toThrow(SyntaxError)
  })
})

describe('deArrowThumbnail', () => {
  it('requests without a timestamp and returns the final URL', async () => {
    fetchMock.mockResolvedValue(mockResponse({ url: 'https://thumb.example/final.webp' }))

    expect(await deArrowThumbnail(VIDEO_ID)).toBe('https://thumb.example/final.webp')
    expect(fetchMock).toHaveBeenCalledWith(`https://thumb.example/api/v1/getThumbnail?videoID=${VIDEO_ID}`)
  })

  it('adds the timestamp, including 0', async () => {
    fetchMock.mockResolvedValue(mockResponse({ url: 'u' }))

    await deArrowThumbnail(VIDEO_ID, 0)
    await deArrowThumbnail(VIDEO_ID, 12.5)

    expect(fetchMock.mock.calls[0][0]).toBe(`https://thumb.example/api/v1/getThumbnail?videoID=${VIDEO_ID}&time=0`)
    expect(fetchMock.mock.calls[1][0]).toBe(`https://thumb.example/api/v1/getThumbnail?videoID=${VIDEO_ID}&time=12.5`)
  })

  it('returns undefined on 204', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 204, url: 'should-not-be-used' }))

    expect(await deArrowThumbnail(VIDEO_ID)).toBeUndefined()
  })

  it('logs and returns undefined when the thumbnail is not generated yet', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 404, json: { error: 'not generated' } }))

    expect(await deArrowThumbnail(VIDEO_ID)).toBeUndefined()
    expect(console.error).toHaveBeenCalledWith({ error: 'not generated' })
  })

  it('rethrows network errors', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(deArrowThumbnail(VIDEO_ID)).rejects.toThrow('Failed to fetch')
  })
})
