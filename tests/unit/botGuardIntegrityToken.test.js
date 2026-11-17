import { describe, expect, it, vi } from 'vitest'

import {
  getIntegrityTokenByteLength,
  isDegradedIntegrityToken,
  MAX_INTEGRITY_TOKEN_ATTEMPTS,
  requestUsableIntegrityToken,
} from '../../src/botGuardIntegrityToken.js'

/** A base64 string of the given length in bytes, padded like GenerateIT's tokens */
const tokenOfBytes = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes).fill(0xfb)))

describe('integrity token length', () => {
  it('decodes the length of padded and unpadded tokens', () => {
    // GenerateIT's usual token is 84 characters (63 bytes), the degraded kind 88 with one "=" (65 bytes)
    expect(tokenOfBytes(63)).toHaveLength(84)
    expect(tokenOfBytes(65)).toHaveLength(88)
    expect(getIntegrityTokenByteLength(tokenOfBytes(63))).toBe(63)
    expect(getIntegrityTokenByteLength(tokenOfBytes(65))).toBe(65)
    expect(getIntegrityTokenByteLength(tokenOfBytes(65).replace(/=+$/, ''))).toBe(65)
  })

  it('only treats 65-byte tokens as degraded', () => {
    expect(isDegradedIntegrityToken(tokenOfBytes(65))).toBe(true)
    expect(isDegradedIntegrityToken(tokenOfBytes(63))).toBe(false)
    expect(isDegradedIntegrityToken(tokenOfBytes(64))).toBe(false)
  })
})

describe('requestUsableIntegrityToken', () => {
  it('asks again with a new snapshot until the token is not degraded', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ integrityToken: tokenOfBytes(65), context: 'first' })
      .mockResolvedValueOnce({ integrityToken: tokenOfBytes(65), context: 'second' })
      .mockResolvedValueOnce({ integrityToken: tokenOfBytes(63), context: 'third' })

    await expect(requestUsableIntegrityToken(request)).resolves.toEqual({ integrityToken: tokenOfBytes(63), context: 'third' })
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('makes one request when the first token is usable', async () => {
    const request = vi.fn().mockResolvedValue({ integrityToken: tokenOfBytes(63), context: null })

    await requestUsableIntegrityToken(request)
    expect(request).toHaveBeenCalledOnce()
  })

  it('gives up after the last attempt and uses that token', async () => {
    const request = vi.fn().mockImplementation(async () => ({ integrityToken: tokenOfBytes(65), context: request.mock.calls.length }))

    await expect(requestUsableIntegrityToken(request)).resolves.toMatchObject({ context: MAX_INTEGRITY_TOKEN_ATTEMPTS })
    expect(request).toHaveBeenCalledTimes(MAX_INTEGRITY_TOKEN_ATTEMPTS)
  })

  it('passes errors through', async () => {
    await expect(requestUsableIntegrityToken(() => Promise.reject(new Error('Could not get integrity token'))))
      .rejects.toThrow('Could not get integrity token')
  })
})
