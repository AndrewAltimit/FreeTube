import { beforeEach, describe, expect, it, vi } from 'vitest'

import { checkYoutubeChannelId, findChannelTagInfo } from '../../../../src/renderer/helpers/channels.js'
import { invidiousGetChannelInfo } from '../../../../src/renderer/helpers/api/invidious'
import { getLocalChannel, parseLocalChannelHeader } from '../../../../src/renderer/helpers/api/local'

vi.mock('../../../../src/renderer/helpers/api/invidious', () => ({
  invidiousGetChannelInfo: vi.fn(),
}))

vi.mock('../../../../src/renderer/helpers/api/local', () => ({
  getLocalChannel: vi.fn(),
  parseLocalChannelHeader: vi.fn(),
}))

const VALID_ID = 'UCabcdefghijklmnopqrstuv'

const local = { preference: 'local', fallback: false }
const invidious = { preference: 'invidious', fallback: false }

describe('checkYoutubeChannelId', () => {
  it.each([
    [VALID_ID, true],
    ['UC_x5XG1OV2P6uZZ5FSM9Ttw', true],
    ['UC-lHJZR3Gqxm24_Vd_AJ5Yw', true],
    ['UCabcdefghijklmnopqrstu', false],
    ['UCabcdefghijklmnopqrstuvw', false],
    ['ucabcdefghijklmnopqrstuv', false],
    ['@handle', false],
    ['UCabcdefghijklmnopqrst.v', false],
    [` ${VALID_ID}`, false],
    ['', false],
  ])('%j -> %s', (id, expected) => {
    expect(checkYoutubeChannelId(id)).toBe(expected)
  })
})

describe('findChannelTagInfo', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('rejects invalid ids without any request', async () => {
    expect(await findChannelTagInfo('@someone', local)).toEqual({ invalidId: true })
    expect(getLocalChannel).not.toHaveBeenCalled()
    expect(invidiousGetChannelInfo).not.toHaveBeenCalled()
  })

  it('uses the Local API and its header parser', async () => {
    const channel = { header: {} }
    getLocalChannel.mockResolvedValue(channel)
    parseLocalChannelHeader.mockReturnValue({ name: 'Local Name', thumbnailUrl: 'https://img/local' })

    expect(await findChannelTagInfo(VALID_ID, local)).toEqual({
      preferredName: 'Local Name',
      icon: 'https://img/local',
      iconHref: `/channel/${VALID_ID}`,
    })
    expect(getLocalChannel).toHaveBeenCalledWith(VALID_ID)
    expect(parseLocalChannelHeader).toHaveBeenCalledWith(channel)
    expect(invidiousGetChannelInfo).not.toHaveBeenCalled()
  })

  it('treats a Local API channel with an alert (terminated/missing) as invalid', async () => {
    getLocalChannel.mockResolvedValue({ alert: 'This channel was terminated' })

    expect(await findChannelTagInfo(VALID_ID, local)).toEqual({ invalidId: true })
    expect(parseLocalChannelHeader).not.toHaveBeenCalled()
  })

  it('uses Invidious when preferred', async () => {
    invidiousGetChannelInfo.mockResolvedValue({
      author: 'Inv Name',
      authorThumbnails: [{ url: 'https://img/first' }, { url: 'https://img/second' }],
    })

    expect(await findChannelTagInfo(VALID_ID, invidious)).toEqual({
      preferredName: 'Inv Name',
      icon: 'https://img/first',
    })
    expect(getLocalChannel).not.toHaveBeenCalled()
  })

  it('reports a non-existent Invidious channel as invalid', async () => {
    invidiousGetChannelInfo.mockRejectedValue(new Error('This channel does not exist.'))

    expect(await findChannelTagInfo(VALID_ID, { preference: 'invidious', fallback: true })).toEqual({ invalidId: true })
    // no fallback for a channel that doesn't exist
    expect(getLocalChannel).not.toHaveBeenCalled()
  })

  // BUG: findChannelTagInfo picks the result parser from `backendOptions.preference`,
  // not from the backend that actually answered (channels.js:50-64). When the
  // Invidious request fails and findChannelById falls back to the Local API, the
  // Local channel object is read as if it were Invidious (`channel.authorThumbnails[0]`)
  // and throws, so the fallback never yields a result.
  it.fails('falls back from Invidious to Local when enabled', async () => {
    invidiousGetChannelInfo.mockRejectedValue(new Error('instance down'))
    getLocalChannel.mockResolvedValue({ header: { type: 'PageHeader' } })
    parseLocalChannelHeader.mockReturnValue({ name: 'Local Name', thumbnailUrl: 'https://img/local' })

    const result = await findChannelTagInfo(VALID_ID, { preference: 'invidious', fallback: true })

    expect(getLocalChannel).toHaveBeenCalledWith(VALID_ID)
    expect(result).toMatchObject({ preferredName: 'Local Name', icon: 'https://img/local' })
  })

  // BUG: the mirror case. A Local failure falls back to Invidious, but the
  // Invidious object is then passed to parseLocalChannelHeader, which reads
  // `channel.header.type` and throws (channels.js:57-64).
  it.fails('falls back from Local to Invidious when enabled', async () => {
    getLocalChannel.mockRejectedValue(new Error('local broke'))
    invidiousGetChannelInfo.mockResolvedValue({ author: 'Inv', authorThumbnails: [{ url: 'u' }] })
    // Mimic the real parser: it dereferences `channel.header.type` first.
    parseLocalChannelHeader.mockImplementation((channel) => {
      if (channel.header.type === undefined) { return null }
      return { name: 'unreachable', thumbnailUrl: 'unreachable' }
    })

    const result = await findChannelTagInfo(VALID_ID, { preference: 'local', fallback: true })

    expect(invidiousGetChannelInfo).toHaveBeenCalledWith(VALID_ID)
    expect(result).toMatchObject({ preferredName: 'Inv', icon: 'u' })
  })

  it('does not fall back when fallback is disabled', async () => {
    invidiousGetChannelInfo.mockRejectedValue(new Error('instance down'))

    const result = await findChannelTagInfo(VALID_ID, invidious)

    expect(getLocalChannel).not.toHaveBeenCalled()
    expect(result.err.message).toBe('instance down')
  })

  it('returns an empty result with the error when the request fails without fallback', async () => {
    const error = new Error('network down')
    getLocalChannel.mockRejectedValue(error)

    expect(await findChannelTagInfo(VALID_ID, local)).toEqual({ preferredName: '', icon: '', iconHref: '', err: error })
    expect(invidiousGetChannelInfo).not.toHaveBeenCalled()
  })
})
