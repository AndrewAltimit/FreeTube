import { afterEach, describe, expect, it, vi } from 'vitest'
import shaka from 'shaka-player'
import { concatenateChunks, u8ToBase64 } from 'googlevideo/utils'
import { CompositeBuffer, UmpWriter } from 'googlevideo/ump'
import {
  MediaHeader,
  ReloadPlaybackContext,
  StreamProtectionStatus,
  UMPPartId,
  VideoPlaybackAbrRequest,
} from 'googlevideo/protos'

import { refreshSabrStream, setupSabrScheme } from '../../../../src/renderer/helpers/player/SabrSchemePlugin.js'

const VIDEO_FORMAT = '137-1-x'
const AUDIO_FORMAT = '251-2-x'
const MEDIA_HEADER_ID = 1
const MEDIA_BYTES = new Uint8Array([9, 8, 7])

const encodeBase64 = (bytes) => u8ToBase64(new Uint8Array(bytes))

/** @param {[number, Uint8Array][]} parts */
function umpResponse(parts) {
  const buffer = new CompositeBuffer()
  const writer = new UmpWriter(buffer)
  for (const [type, data] of parts) {
    writer.write(type, data)
  }
  return new Response(concatenateChunks(buffer.chunks), { status: 200 })
}

function reloadResponse(token) {
  return umpResponse([[
    UMPPartId.RELOAD_PLAYER_RESPONSE,
    ReloadPlaybackContext.encode({ reloadPlaybackParams: { token } }).finish(),
  ]])
}

function rejectedPoTokenResponse() {
  return umpResponse([[
    UMPPartId.STREAM_PROTECTION_STATUS,
    StreamProtectionStatus.encode({ status: 3 }).finish(),
  ]])
}

function initSegmentResponse() {
  return umpResponse([
    [UMPPartId.MEDIA_HEADER, MediaHeader.encode({
      headerId: MEDIA_HEADER_ID,
      formatId: { itag: 137, lastModified: '1', xtags: 'x' },
      isInitSeg: true,
    }).finish()],
    [UMPPartId.MEDIA, new Uint8Array([MEDIA_HEADER_ID, ...MEDIA_BYTES])],
    [UMPPartId.MEDIA_END, new Uint8Array([MEDIA_HEADER_ID])],
  ])
}

const fakePlayer = {
  isAudioOnly: () => false,
  getVariantTracks: () => [{
    active: true,
    originalVideoId: VIDEO_FORMAT,
    originalAudioId: AUDIO_FORMAT,
    audioRoles: ['main'],
    audioBandwidth: 1,
  }],
  getStats: () => ({ estimatedBandwidth: 1000 }),
  getPlaybackRate: () => 1,
}

const clientInfo = { clientName: 1, clientVersion: '2', osName: 'Windows', osVersion: '10' }

/** Sets up the scheme and returns the plugin it registered with shaka-player */
function setup(refreshStreamingData) {
  let plugin
  vi.spyOn(shaka.net.NetworkingEngine, 'registerScheme').mockImplementation((_scheme, p) => { plugin = p })
  vi.spyOn(shaka.net.NetworkingEngine, 'unregisterScheme').mockImplementation(() => {})

  const stream = setupSabrScheme(
    { url: 'https://old.example/sabr?cpn=abc', poToken: encodeBase64([1]), ustreamerConfig: encodeBase64([2]), clientInfo },
    () => fakePlayer,
    () => null,
    { value: 1280 },
    { value: 720 },
    refreshStreamingData,
  )

  const reloads = vi.fn()
  stream.onReloadOnce(reloads)

  const requestInitSegment = () => plugin(
    'sabr:video',
    { uris: [`sabr:video?formatId=${VIDEO_FORMAT}&init&resolution=720`], retryParameters: { timeout: 0 } },
    shaka.net.NetworkingEngine.RequestType.SEGMENT,
    () => {},
    () => {},
    {},
  ).promise

  return { requestInitSegment, reloads }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SABR reload requests', () => {
  it('refreshes the stream in place and retries the segment instead of reloading the player', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reloadResponse('reload-token'))
      .mockResolvedValueOnce(initSegmentResponse())
    vi.stubGlobal('fetch', fetchMock)

    const refresh = vi.fn().mockResolvedValue({
      url: 'https://new.example/sabr?cpn=abc',
      poToken: encodeBase64([5]),
      ustreamerConfig: encodeBase64([6]),
      clientInfo,
    })
    const { requestInitSegment, reloads } = setup(refresh)

    const response = await requestInitSegment()

    expect(refresh).toHaveBeenCalledExactlyOnceWith('reload-token')
    expect(reloads).not.toHaveBeenCalled()
    expect(response.data).toEqual(MEDIA_BYTES)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [retryUrl, retryInit] = fetchMock.mock.calls[1]
    expect(new URL(retryUrl).host).toBe('new.example')
    const retryBody = VideoPlaybackAbrRequest.decode(retryInit.body)
    expect(retryBody.streamerContext.poToken).toEqual(new Uint8Array([5]))
    expect(retryBody.videoPlaybackUstreamerConfig).toEqual(new Uint8Array([6]))
  })

  it('also refreshes when the PO token is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(rejectedPoTokenResponse())
      .mockResolvedValueOnce(initSegmentResponse()))

    const refresh = vi.fn().mockResolvedValue({
      url: 'https://new.example/sabr', poToken: encodeBase64([5]), ustreamerConfig: encodeBase64([6]), clientInfo,
    })
    const { requestInitSegment, reloads } = setup(refresh)

    await expect(requestInitSegment()).resolves.toMatchObject({ data: MEDIA_BYTES })
    expect(refresh).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(reloads).not.toHaveBeenCalled()
  })

  it('falls back to a full player reload when the stream cannot be refreshed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reloadResponse('reload-token'))
    vi.stubGlobal('fetch', fetchMock)

    const { requestInitSegment, reloads } = setup(vi.fn().mockResolvedValue(null))

    await expect(requestInitSegment()).rejects.toMatchObject({ code: shaka.util.Error.Code.OPERATION_ABORTED })
    expect(reloads).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reloads the player when the refreshed stream asks for a reload again', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(reloadResponse('reload-token'))))

    const refresh = vi.fn().mockResolvedValue({
      url: 'https://new.example/sabr', poToken: encodeBase64([5]), ustreamerConfig: encodeBase64([6]), clientInfo,
    })
    const { requestInitSegment, reloads } = setup(refresh)

    await expect(requestInitSegment()).rejects.toMatchObject({ code: shaka.util.Error.Code.OPERATION_ABORTED })
    expect(refresh).toHaveBeenCalledOnce()
    expect(reloads).toHaveBeenCalledOnce()
  })

  it('reloads the player when no refresh is available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reloadResponse('reload-token')))

    const { requestInitSegment, reloads } = setup(undefined)

    await expect(requestInitSegment()).rejects.toMatchObject({ code: shaka.util.Error.Code.OPERATION_ABORTED })
    expect(reloads).toHaveBeenCalledOnce()
  })
})

describe('refreshSabrStream', () => {
  function streamState() {
    return {
      sabrUrl: 'https://old.example/sabr',
      playerReloadRequested: false,
      poToken: new Uint8Array([1]),
      ustreamerConfig: new Uint8Array([2]),
      clientInfo,
      refreshPromise: null,
    }
  }

  it('shares one refresh between concurrent requests', async () => {
    const state = streamState()
    const refresh = vi.fn().mockResolvedValue({
      url: 'https://new.example/sabr', poToken: encodeBase64([5]), ustreamerConfig: encodeBase64([6]), clientInfo,
    })

    const results = await Promise.all([
      refreshSabrStream(state, refresh, 'token'),
      refreshSabrStream(state, refresh, 'token'),
    ])

    expect(results).toEqual([true, true])
    expect(refresh).toHaveBeenCalledOnce()
    expect(state.sabrUrl).toBe('https://new.example/sabr')
    expect(state.poToken).toEqual(new Uint8Array([5]))
    expect(state.refreshPromise).toBeNull()
  })

  it('leaves the stream untouched when the refresh fails', async () => {
    const state = streamState()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(refreshSabrStream(state, vi.fn().mockRejectedValue(new Error('offline')), undefined)).resolves.toBe(false)
    expect(state.sabrUrl).toBe('https://old.example/sabr')
    expect(state.refreshPromise).toBeNull()
  })

  it('does not refresh once a full reload has been requested', async () => {
    const state = { ...streamState(), playerReloadRequested: true }
    const refresh = vi.fn()

    await expect(refreshSabrStream(state, refresh, undefined)).resolves.toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })
})
