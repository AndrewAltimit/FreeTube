import { base64ToU8, concatenateChunks, EventEmitterLike, MAX_INT32_VALUE } from 'googlevideo/utils'
import { CompositeBuffer, UmpReader } from 'googlevideo/ump'
import {
  UMPPartId,
  VideoPlaybackAbrRequest,
  StreamProtectionStatus,
  SabrError,
  SabrRedirect,
  MediaHeader,
  SabrContextSendingPolicy,
  SabrContextUpdate,
  SabrContextWritePolicy,
  NextRequestPolicy,
  PlaybackCookie,
  ReloadPlaybackContext,
} from 'googlevideo/protos'
import shaka from 'shaka-player'

import { deepCopy } from '../utils'

const AbortableOperation = shaka.util.AbortableOperation
const ShakaError = shaka.util.Error

// How far a buffered range may fall short of a segment boundary and still count that segment as buffered
const BUFFERED_RANGE_TOLERANCE_SECONDS = 0.1

// Policy-only responses (no media, no backoff) are retried immediately this many times, then with a growing delay
const IMMEDIATE_POLICY_RETRIES = 2
const MAX_POLICY_RETRY_DELAY_MS = 2000
const MAX_POLICY_RETRIES = 20

// How many times a streaming session may replace a PO token YouTube hasn't accepted before falling back to a player reload
const MAX_PO_TOKEN_REFRESHES = 3

/**
 * @typedef OperationInputs
 * @type {object}
 * @property {string} uri
 * @property {shaka.extern.Request} request
 * @property {shaka.net.NetworkingEngine.RequestType} requestType
 * @property {shaka.extern.HeadersReceived} headersReceived
 * The following are calculated from above properties
 * @property {string} formatIdString
 * @property {boolean} isInit
 * @property {number} sequenceNumber
 */
/**
 * @typedef AbortStatus
 * @type {object}
 * @property {boolean} cancelled
 * @property {boolean} timedOut
 * @property {boolean} playerReloadRequested
 * @property {boolean} finished
 */
/**
 * @typedef CurrentState
 * @type {object}
 * @property {Map<string, Uint8Array>} initDataCache
 * @property {VideoPlaybackAbrRequest} abrRequest
 * @property {RequestInit} requestInit
 * @property {AbortStatus} abortStatus
 * @property {AbortController} abortController
 * @property {SabrStreamState} sabrStreamState
 * @property {?TimeoutController} timeoutController
 * @property {?EventEmitterLike} eventEmitter
 * @property {number} cumulativeBackOffTimeMs
 * @property {number} cumulativeBackOffRequested
 * @property {number} cumulativeRetryDueToNextRequestPolicy
 * @property {() => import('googlevideo/protos').BufferedRange[]} getBufferedRanges
 * @property {Uint8Array} sentPoToken - the PO token the latest request for this segment carried
 */
/**
 * @typedef SabrStreamState
 * @type {object}
 * @property {string} sabrUrl
 * @property {Set<number>} activeSabrContextTypes
 * @property {Map<number, SabrContextUpdate>} sabrContexts
 * @property {?NextRequestPolicy} nextRequestPolicy
 * @property {boolean} playerReloadRequested
 * @property {number} requestNumber
 * @property {Uint8Array} poToken - the PO token new requests carry, replaced by {@linkcode refreshPoTokenIfRejected}
 * @property {(() => Promise<string>) | undefined} refreshPoToken - mints a new base64 PO token
 * @property {?Promise<void>} poTokenRefresh - the refresh in progress, if any
 * @property {number} poTokenRefreshes
 */
/**
 * @typedef TimeoutController
 * @type {object}
 * @property {() => void} resetTimeoutOnce
 * @property {() => void} clearTimeout
 */
/**
 * @typedef SabrStream
 * @type {object}
 * @property {(cb: ({backoffMs: number}) => void) => void} onBackoffRequested
 * @property {(cb: () => void) => void} onReloadOnce
 * @property {() => void | undefined} cleanup
 */

/**
 * @param {string} str
 */
function formatIdFromString(str) {
  const videoFormatIdParts = str.split('-')

  return {
    itag: parseInt(videoFormatIdParts[0]),
    lastModified: videoFormatIdParts[1],
    xtags: videoFormatIdParts[2]
  }
}

/**
 * @param {import('googlevideo/protos').FormatId} formatId
 * @param {shaka.extern.BufferedRange} buffered
 * @param {shaka.media.SegmentIndex} segmentIndex
 */
export function createBufferedRange(formatId, buffered, segmentIndex) {
  // The server reads startSegmentIndex/endSegmentIndex as sequence numbers, which are 1-based
  // (segment position + 1, see the segment index parsers), and won't send a segment it is told is buffered.
  // Only report segments that are completely inside the buffered range: MSE buffered ranges rarely end exactly
  // on a segment boundary, and claiming the partially buffered segment shaka-player is about to request
  // makes the server answer with policy-only responses until the retry limit forces a player reload.
  let startPosition = segmentIndex.find(buffered.start)
  if (startPosition == null) return null

  const startReference = segmentIndex.get(startPosition)
  if (startReference && startReference.startTime < buffered.start - BUFFERED_RANGE_TOLERANCE_SECONDS) {
    startPosition++
  }

  let endPosition = segmentIndex.find(buffered.end)
  if (endPosition == null) {
    // The buffered range reaches the end of the last segment
    endPosition = segmentIndex.getNumReferences() - 1
  } else {
    const endReference = segmentIndex.get(endPosition)
    if (endReference && endReference.endTime > buffered.end + BUFFERED_RANGE_TOLERANCE_SECONDS) {
      endPosition--
    }
  }

  const firstReference = segmentIndex.get(startPosition)
  const lastReference = segmentIndex.get(endPosition)
  if (endPosition < startPosition || !firstReference || !lastReference) return null

  return {
    formatId,
    startTimeMs: String(Math.round(firstReference.startTime * 1000)),
    durationMs: String(Math.round((lastReference.endTime - firstReference.startTime) * 1000)),
    startSegmentIndex: startPosition + 1,
    endSegmentIndex: endPosition + 1,
  }
}

/**
 * Removes the requested segment from the buffered ranges, so the server is never told the client already has it.
 * @param {import('googlevideo/protos').BufferedRange[]} bufferedRanges
 * @param {number} itag
 * @param {number} sequenceNumber
 * @returns {import('googlevideo/protos').BufferedRange[]}
 */
export function excludeRequestedSegment(bufferedRanges, itag, sequenceNumber) {
  return bufferedRanges.filter((range) => {
    return range.formatId?.itag !== itag ||
      !(range.startSegmentIndex <= sequenceNumber && sequenceNumber <= range.endSegmentIndex)
  })
}

/**
 * Creates a bogus buffered range for a format. Used when we want to signal to the server to not send any
 * segments for this format.
 * @param {import('googlevideo/protos').FormatId} formatId - The format to create a full buffer range for.
 * @returns {import('googlevideo/protos').BufferedRange} A BufferedRange object indicating the entire format is buffered.
 */
function createFullBufferRange(formatId) {
  return {
    formatId: formatId,
    durationMs: MAX_INT32_VALUE,
    startTimeMs: '0',
    startSegmentIndex: parseInt(MAX_INT32_VALUE),
    endSegmentIndex: parseInt(MAX_INT32_VALUE),
    timeRange: {
      durationTicks: MAX_INT32_VALUE,
      startTicks: '0',
      timescale: 1000
    }
  }
}

/**
 * @param {shaka.Player} player
 * @param {shaka.extern.Manifest} manifest
 * @param {boolean} audioFormatsActive
 * @param {boolean} streamIsVideo - Fake audio bufferRange can be used
 * @param {boolean} streamIsAudio - Fake video bufferRange can be used
 * @param {import('googlevideo/protos').BufferedRange[]} bufferedRanges
 * @param {shaka.extern.Track} activeVariant
 */
function fillBufferedRanges(player, manifest, audioFormatsActive, streamIsVideo, streamIsAudio, bufferedRanges, activeVariant) {
  const bufferedInfo = player.getBufferedInfo()

  if (bufferedInfo.audio.length > 0 || bufferedInfo.video.length > 0) {
    let activeManifestVariant
    if (audioFormatsActive) {
      activeManifestVariant = manifest.variants.find((variant) => {
        return variant.audio.originalId === activeVariant.originalAudioId
      })
    } else {
      activeManifestVariant = manifest.variants.find((variant) => {
        return variant.audio.originalId === activeVariant.originalAudioId &&
          variant.video.originalId === activeVariant.originalVideoId
      })
    }

    const audioFormatId = formatIdFromString(activeVariant.originalAudioId)
    const audioSegmentIndex = activeManifestVariant.audio.segmentIndex

    if (streamIsVideo) {
      bufferedRanges.push(createFullBufferRange(audioFormatId))
    } else {
      for (const buffered of bufferedInfo.audio) {
        const range = createBufferedRange(audioFormatId, buffered, audioSegmentIndex)
        if (range) bufferedRanges.push(range)
      }
    }

    // Lazily initialize these variables as video data won't exist for audio-only playback
    let videoFormatId
    let videoSegmentIndex

    if (streamIsAudio && bufferedInfo.video.length > 0) {
      videoFormatId = formatIdFromString(activeVariant.originalVideoId)
      bufferedRanges.push(createFullBufferRange(videoFormatId))
    } else {
      for (const buffered of bufferedInfo.video) {
        if (!videoFormatId) {
          videoFormatId = formatIdFromString(activeVariant.originalVideoId)
        }

        if (!videoSegmentIndex) {
          videoSegmentIndex = activeManifestVariant.video.segmentIndex
        }

        const range = createBufferedRange(videoFormatId, buffered, videoSegmentIndex)
        if (range) bufferedRanges.push(range)
      }
    }
  }
}

/**
 * @param {string} uri
 * @param {shaka.extern.Request} request
 * @param {Uint8Array} data
 * @returns {shaka.util.AbortableOperation<shaka.extern.Response>}
 */
function createCacheResponse(uri, request, data) {
  return AbortableOperation.completed({
    data,
    fromCache: true,
    headers: {},
    originalRequest: request,
    originalUri: uri,
    uri
  })
}

/**
 * @param {shaka.util.Error.Code} code
 * @param {...any} args
 */
function createRecoverableNetworkError(code, ...args) {
  return new ShakaError(ShakaError.Severity.RECOVERABLE, ShakaError.Category.NETWORK, code, ...args)
}

/**
 * @param {SabrStreamState} sabrStreamState
 */
function prepareSabrContexts(sabrStreamState) {
  /** @type {SabrContextUpdate[]} */
  const sabrContexts = []
  /** @type {number[]} */
  const unsentSabrContexts = []

  for (const ctxUpdate of sabrStreamState.sabrContexts.values()) {
    if (sabrStreamState.activeSabrContextTypes.has(ctxUpdate.type)) {
      sabrContexts.push(ctxUpdate)
    } else {
      unsentSabrContexts.push(ctxUpdate.type)
    }
  }

  return { sabrContexts, unsentSabrContexts }
}

/**
 * @template T
 * @param {import('googlevideo/shared-types').Part} part
 * @param {{ decode: (data: Uint8Array) => T }} decoder
 * @returns {T | undefined}
 */
function decodePart(part, decoder) {
  if (!part.data.chunks.length) return undefined

  try {
    const chunk = part.data.chunks.length === 1 ? part.data.chunks[0] : concatenateChunks(part.data.chunks)
    return decoder.decode(chunk)
  } catch {
    return undefined
  }
}

/**
 * @param {(args: void) => void} callback
 * @param {number} timeoutMs
 * @return TimeoutController
 */
function createTimeoutController(callback, timeoutMs) {
  return {
    _timeout: setTimeout(callback, timeoutMs),
    _resetCount: 0,
    resetTimeoutOnce() {
      if (this._resetCount > 0) return

      this.clearTimeout()
      this._timeout = setTimeout(callback, timeoutMs)
      this._resetCount++
    },
    clearTimeout() {
      clearTimeout(this._timeout)
    },
  }
}

/**
 * Development-only: one console line per SABR response, so retry loops can be diagnosed.
 * Filter the DevTools console by "[SABR]".
 * @param {OperationInputs} operationInputs
 * @param {CurrentState} currentState
 * @param {Response | undefined} response
 * @param {string[]} parts
 * @param {boolean} segmentComplete
 * @param {boolean} shouldRetry
 */
function logSabrResponse(operationInputs, currentState, response, parts, segmentComplete, shouldRetry) {
  const clientState = currentState.abrRequest.clientAbrState
  const ranges = currentState.abrRequest.bufferedRanges
    .map(range => `${range.formatId?.itag}:${range.startSegmentIndex}-${range.endSegmentIndex}`)
    .join(',')
  const outcome = segmentComplete ? 'complete' : (shouldRetry ? `retry #${currentState.cumulativeRetryDueToNextRequestPolicy + 1}` : 'no data')

  // eslint-disable-next-line no-console -- development-only diagnostics
  console.debug(
    `[SABR] want ${operationInputs.formatIdString} ${operationInputs.isInit ? 'init' : `sq=${operationInputs.sequenceNumber}`}` +
    ` playerTimeMs=${clientState.playerTimeMs} buffered=[${ranges}]` +
    ` -> HTTP ${response?.status} [${parts.join(' ')}] => ${outcome}`
  )
}

/**
 * Delay before the next request when the previous responses only carried a next request policy without media.
 * The server's own backoff time is honoured separately.
 * @param {CurrentState} currentState
 * @returns {number}
 */
export function getPolicyRetryDelayMs(currentState) {
  const retries = currentState.cumulativeRetryDueToNextRequestPolicy
  if (retries <= IMMEDIATE_POLICY_RETRIES || (currentState.sabrStreamState.nextRequestPolicy?.backoffTimeMs || 0) > 0) {
    return 0
  }

  return Math.min(100 * 2 ** (retries - IMMEDIATE_POLICY_RETRIES - 1), MAX_POLICY_RETRY_DELAY_MS)
}

/**
 * Starts minting a replacement PO token when the server says it hasn't accepted the one this request carried.
 *
 * Every response grades the token in STREAM_PROTECTION_STATUS: 1 accepted, 2 attestation pending, 3 attestation
 * required. A pending session is still served roughly the first minute of the video, then (or straight away after
 * seeking past it) gets status 3 and no media. Replacing the token as soon as it is graded pending usually lands
 * the new one before it is needed, without a player reload. Whether YouTube accepts a new token is hit and miss,
 * so a session gets at most {@linkcode MAX_PO_TOKEN_REFRESHES} replacements.
 * @param {CurrentState} currentState
 */
export function refreshPoTokenIfRejected(currentState) {
  const state = currentState.sabrStreamState

  if (
    !state.refreshPoToken || state.poTokenRefresh || state.poTokenRefreshes >= MAX_PO_TOKEN_REFRESHES ||
    // Already replaced since this request was sent, the new token hasn't been graded yet
    currentState.sentPoToken !== state.poToken
  ) {
    return
  }

  state.poTokenRefreshes++

  if (process.env.NODE_ENV === 'development') {
    console.warn(`[SABR] PO token not accepted, minting a new one (${state.poTokenRefreshes}/${MAX_PO_TOKEN_REFRESHES})`)
  }

  state.poTokenRefresh = state.refreshPoToken()
    .then((token) => {
      state.poToken = base64ToU8(token)
    })
    .catch((error) => {
      console.error('SABR: minting a replacement PO token failed', error)
    })
    .finally(() => {
      state.poTokenRefresh = null
    })
}

/**
 * Waits for a replacement PO token after the server refused the current one (stream protection status 3).
 * @param {CurrentState} currentState
 * @returns {Promise<boolean>} whether there is a newer token than the one this request carried
 */
export async function waitForReplacementPoToken(currentState) {
  refreshPoTokenIfRejected(currentState)

  const refresh = currentState.sabrStreamState.poTokenRefresh
  if (refresh) {
    await refresh
  }

  return currentState.sabrStreamState.poToken !== currentState.sentPoToken
}

/**
 * @param {OperationInputs} operationInputs - readonly
 * @param {CurrentState} currentState - can be updated
 */
async function doRequest(
  operationInputs,
  currentState,
) {
  let response
  /** @type {CompositeBuffer | null} */
  let chunkedDataBuffer = null
  /** @type {Uint8Array[]} */
  const responseDataChunks = []
  let segmentComplete = false
  let shouldRetry = false
  let shouldRetryDueToNextRequestPolicy = false

  let invalidPoToken = false
  let error

  // Development-only diagnostics for SABR retry loops, see logSabrResponse
  const debugParts = process.env.NODE_ENV === 'development' ? [] : null

  if (currentState.sabrStreamState.playerReloadRequested) {
    // Multiple requests might be issued at the same time, other requests should abort themselves once reload requested
    throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
  }

  try {
    let shouldReloadDueToBackoffLoop = false
    if ((currentState.sabrStreamState.nextRequestPolicy?.backoffTimeMs || 0) > 0) {
      const currentBackoffTimeMs = currentState.sabrStreamState.nextRequestPolicy.backoffTimeMs
      currentState.eventEmitter.emit('backoff-requested', { backoffMs: currentBackoffTimeMs })
      // Wait but can be aborted
      await new Promise((resolve, reject) => {
        setTimeout(resolve, currentBackoffTimeMs)
        currentState.abortController.signal.addEventListener('abort', reject)
      })
      // Must reset AFTER waiting to avoid requested aborted
      // Since long backoff time mostly happens on the start of video playback we only reset timeout once
      // i.e. backoff time parts received will not reset timeout - counted as video loading issue
      currentState.timeoutController?.resetTimeoutOnce()

      currentState.cumulativeBackOffTimeMs += currentState.sabrStreamState.nextRequestPolicy.backoffTimeMs
      currentState.cumulativeBackOffRequested += 1
      const timeoutMs = operationInputs.request.retryParameters.timeout
      // Detect infinite backoff loop by no. of times requested and cumulative time approaching timeout
      if (currentState.cumulativeBackOffRequested >= 3 || (timeoutMs > 0 && timeoutMs <= (currentState.cumulativeBackOffTimeMs + currentBackoffTimeMs))) {
        shouldReloadDueToBackoffLoop = true
      }
    }
    if (shouldReloadDueToBackoffLoop || currentState.cumulativeRetryDueToNextRequestPolicy >= MAX_POLICY_RETRIES) {
      // Fire fake reload event due to detecting retry loop
      currentState.sabrStreamState.playerReloadRequested = true
      if (!currentState.abortController.signal.aborted) {
        currentState.abortController.abort()
        currentState.eventEmitter.emit('reload')
      }
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[SABR] giving up on ${operationInputs.formatIdString} sq=${operationInputs.sequenceNumber}: ${shouldReloadDueToBackoffLoop ? 'backoff loop' : `${MAX_POLICY_RETRIES} policy-only retries`}, requesting reload`)
      }
      // Don't send another request once the reload has been requested
      throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
    }

    const policyRetryDelayMs = getPolicyRetryDelayMs(currentState)
    if (policyRetryDelayMs > 0) {
      // Repeated policy-only responses: don't hammer the server, which can end the session with HTTP 403
      await new Promise((resolve, reject) => {
        setTimeout(resolve, policyRetryDelayMs)
        currentState.abortController.signal.addEventListener('abort', reject)
      })
    }

    const sabrURL = new URL(currentState.sabrStreamState.sabrUrl)
    sabrURL.searchParams.set('rn', String(currentState.sabrStreamState.requestNumber++))
    response = await fetch(sabrURL.toString(), currentState.requestInit)

    operationInputs.headersReceived({})

    const { itag, lastModified, xtags } = formatIdFromString(operationInputs.formatIdString)
    let mediaHeaderId

    const reader = response.body.getReader()
    let readObj = await reader.read()

    while (!readObj.done && !currentState.abortStatus.finished) {
      if (chunkedDataBuffer) {
        chunkedDataBuffer.append(readObj.value)
      } else {
        chunkedDataBuffer = new CompositeBuffer([readObj.value])
      }

      const remainingData = new UmpReader(chunkedDataBuffer).read((part) => {
        switch (part.type) {
          case UMPPartId.STREAM_PROTECTION_STATUS: {
            const streamProtectionStatus = decodePart(part, StreamProtectionStatus)
            if (!streamProtectionStatus) break

            if (streamProtectionStatus.status === 2 || streamProtectionStatus.status === 3) {
              refreshPoTokenIfRejected(currentState)
            }
            if (streamProtectionStatus.status === 3) {
              invalidPoToken = true
            }
            debugParts?.push(`protection=${streamProtectionStatus.status}`)
            break
          }
          case UMPPartId.SABR_ERROR: {
            const sabrError = decodePart(part, SabrError)
            if (!sabrError) break

            error = `SABR Error: type: ${sabrError.type}, code: ${sabrError.code}`
            debugParts?.push(error)
            break
          }
          case UMPPartId.SABR_REDIRECT: {
            const sabrRedirect = decodePart(part, SabrRedirect)
            if (!sabrRedirect?.url) break

            currentState.sabrStreamState.sabrUrl = sabrRedirect.url
            shouldRetry = true
            debugParts?.push('redirect')
            break
          }
          case UMPPartId.MEDIA_HEADER: {
            if (debugParts) {
              const header = decodePart(part, MediaHeader)
              if (header) {
                debugParts.push(`media(itag=${header.formatId?.itag} ${header.isInitSeg ? 'init' : `sq=${header.sequenceNumber}`} startMs=${header.startMs})`)
              }
            }
            if (mediaHeaderId === undefined) {
              const mediaHeader = decodePart(part, MediaHeader)
              if (!mediaHeader) break

              if (
                mediaHeader.formatId.itag === itag &&
                mediaHeader.formatId.lastModified === lastModified &&
                mediaHeader.formatId.xtags === xtags
              ) {
                if (operationInputs.isInit && mediaHeader.isInitSeg) {
                  mediaHeaderId = mediaHeader.headerId
                } else if (!operationInputs.isInit && mediaHeader.sequenceNumber === operationInputs.sequenceNumber) {
                  mediaHeaderId = mediaHeader.headerId
                }
              }
            }

            break
          }
          case UMPPartId.MEDIA: {
            if (mediaHeaderId === part.data.getUint8(0)) {
              responseDataChunks.push(...part.data.split(1).remainingBuffer.chunks)
            }
            break
          }
          case UMPPartId.MEDIA_END: {
            if (mediaHeaderId === part.data.getUint8(0)) {
              segmentComplete = true
              currentState.abortStatus.finished = true
              currentState.abortController.abort()
            }
            break
          }
          case UMPPartId.NEXT_REQUEST_POLICY: {
            const nextRequestPolicy = decodePart(part, NextRequestPolicy)

            shouldRetry = true
            shouldRetryDueToNextRequestPolicy = true

            currentState.sabrStreamState.nextRequestPolicy = nextRequestPolicy
            currentState.abrRequest.streamerContext.playbackCookie = nextRequestPolicy?.playbackCookie ? PlaybackCookie.encode(nextRequestPolicy.playbackCookie).finish() : undefined

            currentState.abrRequest.streamerContext.backoffTimeMs = nextRequestPolicy?.backoffTimeMs
            debugParts?.push(`policy(backoffMs=${nextRequestPolicy?.backoffTimeMs ?? 0} targetAudioReadaheadMs=${nextRequestPolicy?.targetAudioReadaheadMs ?? '-'} targetVideoReadaheadMs=${nextRequestPolicy?.targetVideoReadaheadMs ?? '-'})`)
            break
          }
          case UMPPartId.FORMAT_INITIALIZATION_METADATA: {
            break
          }
          case UMPPartId.SABR_CONTEXT_UPDATE: {
            const sabrContextUpdate = decodePart(part, SabrContextUpdate)
            if (!sabrContextUpdate) break

            if (sabrContextUpdate.type !== undefined && sabrContextUpdate.value?.length) {
              if (
                sabrContextUpdate.writePolicy === SabrContextWritePolicy.KEEP_EXISTING &&
                currentState.sabrStreamState.sabrContexts.has(sabrContextUpdate.type)
              ) {
                break
              }

              currentState.sabrStreamState.sabrContexts.set(sabrContextUpdate.type, sabrContextUpdate)

              if (sabrContextUpdate.sendByDefault) {
                currentState.sabrStreamState.activeSabrContextTypes.add(sabrContextUpdate.type)
              }
            }
            break
          }
          case UMPPartId.SABR_CONTEXT_SENDING_POLICY: {
            const sabrContextSendingPolicy = decodePart(part, SabrContextSendingPolicy)
            if (!sabrContextSendingPolicy) break

            for (const startPolicy of sabrContextSendingPolicy.startPolicy) {
              if (!currentState.sabrStreamState.activeSabrContextTypes.has(startPolicy)) {
                currentState.sabrStreamState.activeSabrContextTypes.add(startPolicy)
              }
            }

            for (const stopPolicy of sabrContextSendingPolicy.stopPolicy) {
              if (currentState.sabrStreamState.activeSabrContextTypes.has(stopPolicy)) {
                currentState.sabrStreamState.activeSabrContextTypes.delete(stopPolicy)
              }
            }

            for (const discardPolicy of sabrContextSendingPolicy.discardPolicy) {
              if (currentState.sabrStreamState.sabrContexts.has(discardPolicy)) {
                currentState.sabrStreamState.sabrContexts.delete(discardPolicy)
              }
            }
            break
          }
          case UMPPartId.RELOAD_PLAYER_RESPONSE: {
            const reloadPlaybackContext = decodePart(part, ReloadPlaybackContext)
            if (!reloadPlaybackContext) break

            // Whole video cannot be played
            debugParts?.push('RELOAD_PLAYER_RESPONSE')
            currentState.sabrStreamState.playerReloadRequested = true
            if (!currentState.abortController.signal.aborted) {
              currentState.abortController.abort()
              currentState.eventEmitter.emit('reload')
            }
            break
          }
          default: {
            break
          }
        }
      })

      if (!currentState.abortStatus.finished) {
        if (remainingData) {
          chunkedDataBuffer = remainingData.data
        } else {
          chunkedDataBuffer = null
        }

        readObj = await reader.read()
      }
    }
  } catch (error) {
    if (currentState.abortStatus.cancelled) {
      throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
    } else if (currentState.abortStatus.timedOut) {
      throw createRecoverableNetworkError(ShakaError.Code.TIMEOUT, operationInputs.uri, operationInputs.requestType)
    } else if (!currentState.abortStatus.finished) {
      throw createRecoverableNetworkError(ShakaError.Code.HTTP_ERROR, operationInputs.uri, error, operationInputs.requestType)
    }
  }

  if (currentState.abortStatus.cancelled) {
    throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
  } else if (currentState.abortStatus.timedOut) {
    throw createRecoverableNetworkError(ShakaError.Code.TIMEOUT, operationInputs.uri, operationInputs.requestType)
  }

  if (debugParts) {
    logSabrResponse(operationInputs, currentState, response, debugParts, segmentComplete, shouldRetry)
  }

  if (responseDataChunks.length > 0 && segmentComplete) {
    const data = /** @__NOINLINE__ */ concatenateChunks(responseDataChunks)

    if (operationInputs.isInit) {
      currentState.initDataCache.set(operationInputs.formatIdString, data)
    }

    /** @type {shaka.extern.Response} */
    return {
      uri: operationInputs.uri,
      originalUri: operationInputs.uri,
      data,
      status: response.status,
      headers: {},
      fromCache: false,
      originalRequest: operationInputs.request,
    }
  } else if (invalidPoToken && !(await waitForReplacementPoToken(currentState))) {
    // Stream protection status 3 (attestation required): the server won't send media with this PO token,
    // however long it is asked to back off, and no replacement could be minted. Reload to start a new session.
    currentState.sabrStreamState.playerReloadRequested = true
    if (!currentState.abortController.signal.aborted) {
      currentState.abortController.abort()
      currentState.eventEmitter.emit('reload')
    }
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[SABR] PO token rejected (attestation required) for ${operationInputs.formatIdString} sq=${operationInputs.sequenceNumber}, requesting reload`)
    }
    throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
  } else if (shouldRetry || invalidPoToken) {
    // invalidPoToken here means a replacement token is ready, retry with it
    if (shouldRetryDueToNextRequestPolicy) {
      // Only count on actual retry to avoid counting false positive (when segmentComplete
      currentState.cumulativeRetryDueToNextRequestPolicy += 1
    }

    const { sabrContexts, unsentSabrContexts } = prepareSabrContexts(currentState.sabrStreamState)

    // The buffer may have changed since the first request (e.g. shaka-player clearing it after a seek)
    currentState.abrRequest.bufferedRanges = currentState.getBufferedRanges()
    currentState.abrRequest.streamerContext.poToken = currentState.sabrStreamState.poToken
    currentState.sentPoToken = currentState.sabrStreamState.poToken
    currentState.abrRequest.streamerContext.sabrContexts = sabrContexts
    currentState.abrRequest.streamerContext.unsentSabrContexts = unsentSabrContexts

    let body

    try {
      body = VideoPlaybackAbrRequest.encode(currentState.abrRequest).finish()
    } catch (error) {
      console.error('Invalid VideoPlaybackAbrRequest data', currentState.abrRequest)
      throw error
    }

    currentState.requestInit = {
      body,
      method: 'POST',
      headers: {
        'content-type': 'application/x-protobuf',
        'accept-encoding': 'identity',
        accept: 'application/vnd.yt-ump',
      },
      signal: currentState.abortController.signal,
    }
    currentState.abortStatus.timedOut = false

    currentState.abortStatus.finished = false
    return doRequest(operationInputs, currentState)
  } else if (error) {
    throw createRecoverableNetworkError(
      ShakaError.Code.HTTP_ERROR,
      operationInputs.uri,
      new Error(error),
      operationInputs.requestType,
    )
  } else if (responseDataChunks.length > 0 && !segmentComplete) {
    throw createRecoverableNetworkError(
      ShakaError.Code.HTTP_ERROR,
      operationInputs.uri,
      new Error('Incomplete segment, missing MEDIA_END part'),
      operationInputs.requestType,
    )
  } else if (response.status === 200) {
    throw createRecoverableNetworkError(
      ShakaError.Code.HTTP_ERROR,
      operationInputs.uri,
      new Error('Empty response, this should not happen'),
      operationInputs.requestType,
    )
  } else {
    const severity = response.status === 401 || response.status === 403
      ? ShakaError.Severity.CRITICAL
      : ShakaError.Severity.RECOVERABLE

    throw new ShakaError(
      severity,
      ShakaError.Category.NETWORK,
      ShakaError.Code.BAD_HTTP_STATUS,
      operationInputs.uri,
      response.status,
      '',
      {},
      operationInputs.requestType,
      operationInputs.uri,
    )
  }
}

/**
 * @param {import('../../views/Watch/Watch').SabrData} sabrData
 * @param {() => shaka.Player} getPlayer
 * @param {() => shaka.extern.Manifest} getManifest
 * @param {import('vue').ComputedRef<number>} playerWidth
 * @param {import('vue').ComputedRef<number>} playerHeight
 * @return SabrStream
 */
export function setupSabrScheme(sabrData, getPlayer, getManifest, playerWidth, playerHeight) {
  const eventEmitter = new EventEmitterLike()

  /**
   * Caches the init data until the video ends
   * that way changing qualities and between audio and DASH
   * doesn't have to fetch the init data and segment index again
   * @type {Map<string, Uint8Array>}
   */
  const initDataCache = new Map()

  const videoPlaybackUstreamerConfig = base64ToU8(sabrData.ustreamerConfig)
  const clientInfo = deepCopy(sabrData.clientInfo)

  /** @type {SabrStreamState} */
  const sabrStreamState = {
    sabrUrl: sabrData.url,
    activeSabrContextTypes: new Set(),
    sabrContexts: new Map(),
    nextRequestPolicy: undefined,
    playerReloadRequested: false,
    requestNumber: 0,
    poToken: base64ToU8(sabrData.poToken),
    refreshPoToken: sabrData.refreshPoToken,
    poTokenRefresh: null,
    poTokenRefreshes: 0,
  }

  shaka.net.NetworkingEngine.registerScheme('sabr', (uri, request, requestType, _progressUpdated, headersReceived, _config) => {
    // lazily fetch it as the variable is only set after setupSabrScheme is called
    // but it will definitely exist when we receive a request here.
    const player = getPlayer()
    if (player == null) {
      // This is true during reload, returning a promise to suppress error
      return new AbortableOperation(Promise.resolve())
    }
    const isAudioOnly = player.isAudioOnly()

    const url = new URL(request.uris[0])

    const isInit = url.searchParams.has('init')
    const formatIdString = url.searchParams.get('formatId')

    if (isInit && initDataCache.has(formatIdString)) {
      return /** @__NOINLINE__ */ createCacheResponse(uri, request, initDataCache.get(formatIdString))
    }

    const variantTracks = player.getVariantTracks()
    const activeVariant = variantTracks.find(track => track.active)

    const streamIsAudio = url.pathname === 'audio'
    const streamIsVideo = url.pathname === 'video'

    let audioFormatId
    let videoFormatId

    if (streamIsAudio) {
      audioFormatId = formatIdFromString(formatIdString)

      if (isAudioOnly) {
        // We need to specify a video format even for audio only otherwise we get an error response
        videoFormatId = formatIdFromString(url.searchParams.get('videoFormatId'))
      } else {
        videoFormatId = formatIdFromString((activeVariant ?? variantTracks[0]).originalVideoId)
      }
    } else if (streamIsVideo) {
      videoFormatId = formatIdFromString(formatIdString)

      // for the first fetching of the initial data there won't be an active variant
      // (shaka-player only sets it to active after it has fetched the init/segment data)
      if (activeVariant) {
        audioFormatId = formatIdFromString(activeVariant.originalAudioId)
      } else {
        const candidates = variantTracks.filter((track) => track.audioRoles.includes('main'))

        const probableAudioFormat = candidates.reduce((previous, current) => {
          return current.audioBandwidth >= previous.audioBandwidth ? current : previous
        }, candidates[0])

        audioFormatId = formatIdFromString(probableAudioFormat.originalAudioId)
      }
    }

    const sequenceNumber = parseInt(url.searchParams.get('sq'))
    const requestedItag = formatIdFromString(formatIdString).itag

    /** @type {import('googlevideo/protos').BufferedRange[]} */
    let bufferedRanges = []

    const getBufferedRanges = () => {
      const currentPlayer = getPlayer()
      if (isInit || currentPlayer == null) return bufferedRanges

      const currentVariant = currentPlayer.getVariantTracks().find(track => track.active)
      if (!currentVariant) return bufferedRanges

      /** @type {import('googlevideo/protos').BufferedRange[]} */
      const ranges = []
      /** @__NOINLINE__ */ fillBufferedRanges(currentPlayer, getManifest(), isAudioOnly, streamIsVideo, streamIsAudio, ranges, currentVariant)
      return excludeRequestedSegment(ranges, requestedItag, sequenceNumber)
    }

    bufferedRanges = getBufferedRanges()

    let playerTimeMs = '0'

    if (url.searchParams.has('startTimeMs')) {
      playerTimeMs = url.searchParams.get('startTimeMs')
    }

    const drcEnabled = url.searchParams.has('drc') || !!(activeVariant && activeVariant.audioRoles.includes('drc'))
    const enableVoiceBoost = url.searchParams.has('vb') || !!(activeVariant && activeVariant.audioRoles.includes('vb'))

    const resolution = streamIsVideo ? parseInt(url.searchParams.get('resolution')) : undefined

    const { sabrContexts, unsentSabrContexts } = prepareSabrContexts(sabrStreamState)

    /** @type {VideoPlaybackAbrRequest} */
    const requestData = {
      clientAbrState: {
        bandwidthEstimate: String(Math.round(player.getStats().estimatedBandwidth)),
        timeSinceLastManualFormatSelectionMs: streamIsVideo ? '0' : undefined,
        stickyResolution: resolution,
        lastManualSelectedResolution: resolution,
        playbackRate: player.getPlaybackRate(),
        enabledTrackTypesBitfield: streamIsAudio ? 1 : 0,
        drcEnabled,
        enableVoiceBoost,
        playerTimeMs,
        clientViewportWidth: playerWidth.value,
        clientViewportHeight: playerHeight.value,
        clientViewportIsFlexible: false
      },
      preferredAudioFormatIds: [audioFormatId],
      preferredVideoFormatIds: [videoFormatId],
      preferredSubtitleFormatIds: [],
      selectedFormatIds: isInit ? [] : [audioFormatId, videoFormatId],
      bufferedRanges,
      streamerContext: {
        poToken: sabrStreamState.poToken,
        clientInfo,
        sabrContexts,
        unsentSabrContexts,
        playbackCookie: sabrStreamState.nextRequestPolicy?.playbackCookie ? PlaybackCookie.encode(sabrStreamState.nextRequestPolicy.playbackCookie).finish() : undefined,
      },
      field1000: [],
      videoPlaybackUstreamerConfig,
    }

    let body

    try {
      body = VideoPlaybackAbrRequest.encode(requestData).finish()
    } catch (error) {
      console.error('Invalid VideoPlaybackAbrRequest data', requestData)
      throw error
    }

    /**
     * Stores whatever state that should be updated across the whole "session"
     * @type {OperationInputs}
     */
    const opInputs = {
      uri,
      request,
      requestType,
      headersReceived,

      formatIdString,
      isInit,
      sequenceNumber,
    }

    const abortController = new AbortController()

    /** @type {RequestInit} */
    const init = {
      body,
      method: 'POST',
      headers: {
        'content-type': 'application/x-protobuf',
        'accept-encoding': 'identity',
        accept: 'application/vnd.yt-ump',
      },
      signal: abortController.signal,
    }

    /**
     * Stores whatever state that should be updated across the whole "session"
     * @type {AbortStatus}
     */
    const abortStatus = {
      cancelled: false,
      timedOut: false,
      finished: false,
    }

    const timeoutMs = request.retryParameters.timeout
    let timeoutController = null
    if (timeoutMs) {
      timeoutController = createTimeoutController(() => {
        abortStatus.timedOut = true
        abortController.abort()
      }, timeoutMs)
    }

    /**
     * Stores whatever state that should be updated across the whole "session"
     * @type {CurrentState}
     */
    const currentState = {
      initDataCache,
      abrRequest: requestData,
      requestInit: init,
      abortStatus: abortStatus,
      abortController,
      sabrStreamState,
      timeoutController,
      eventEmitter,
      cumulativeBackOffTimeMs: 0,
      cumulativeBackOffRequested: 0,
      cumulativeRetryDueToNextRequestPolicy: 0,
      getBufferedRanges,
      sentPoToken: requestData.streamerContext.poToken,
    }

    const pendingRequest = doRequest(opInputs, currentState)

    const op = new AbortableOperation(pendingRequest, () => {
      abortStatus.cancelled = true
      abortController.abort()
      return Promise.resolve()
    })

    if (timeoutController) {
      op.finally(() => {
        timeoutController.clearTimeout()
      })
    }

    return op
  })

  const cleanup = () => {
    shaka.net.NetworkingEngine.unregisterScheme('sabr')
    initDataCache.clear()
  }

  return {
    onBackoffRequested(callback) {
      eventEmitter.on('backoff-requested', callback)
    },
    onReloadOnce(callback) {
      eventEmitter.once('reload', callback)
    },
    cleanup,
  }
}
