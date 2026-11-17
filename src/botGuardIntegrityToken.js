// Bundled into src/botGuardScript.js. Kept in its own module so it can be unit tested: botGuardScript.js may only have
// a default export (src/main/poTokenGenerator.js rewrites its `export{x as default};` statement).

/**
 * GenerateIT sometimes issues a 65-byte integrity token instead of the usual 63-byte one. PO tokens minted from the
 * longer kind are never accepted for SABR streams: the stream stays "attestation pending" (stream protection status 2),
 * which gives about a minute of media and then only empty responses. A fresh BotGuard snapshot usually gets the
 * usual kind.
 */
export const DEGRADED_INTEGRITY_TOKEN_BYTES = 65

/** Attempts at getting a usual integrity token before using whatever the last attempt returned */
export const MAX_INTEGRITY_TOKEN_ATTEMPTS = 5

/**
 * @param {string} integrityToken base64, standard or websafe, with or without padding
 * @returns {number} the decoded length in bytes
 */
export function getIntegrityTokenByteLength(integrityToken) {
  const unpadded = integrityToken.replace(/=+$/, '')
  return Math.floor(unpadded.length * 3 / 4)
}

/**
 * @param {string} integrityToken
 * @returns {boolean}
 */
export function isDegradedIntegrityToken(integrityToken) {
  return getIntegrityTokenByteLength(integrityToken) === DEGRADED_INTEGRITY_TOKEN_BYTES
}

/**
 * Requests integrity tokens until one isn't the degraded kind, or the attempts run out.
 * @template T
 * @param {() => Promise<{ integrityToken: string, context: T }>} requestIntegrityToken takes a new snapshot and
 * requests an integrity token for it; `context` is whatever the caller needs alongside it (the snapshot's
 * webPoSignalOutput)
 * @returns {Promise<{ integrityToken: string, context: T }>}
 */
export async function requestUsableIntegrityToken(requestIntegrityToken) {
  let result
  for (let attempt = 1; attempt <= MAX_INTEGRITY_TOKEN_ATTEMPTS; attempt++) {
    result = await requestIntegrityToken()
    if (!isDegradedIntegrityToken(result.integrityToken)) {
      break
    }
  }
  return result
}
