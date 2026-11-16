import { BotGuardClient, getChallenge } from 'bgutils-js/botguard'
import { buildURL, GOOG_API_KEY } from 'bgutils-js/utils'
import { WebPoMinter } from 'bgutils-js/webpo'

// This script has it's own webpack config, as it gets passed as a string to Electron's evaluateJavaScript function
// in src/main/poTokenGenerator.js

/**
 * Based on: https://github.com/LuanRT/BgUtils/blob/main/examples/node/innertube-challenge-fetcher-example.ts
 * @param {string} videoId
 * @param {import('youtubei.js').Session['context']} context
 * @param {object} initialAttestationData
 * @param {object} ytConfig
 * @param {string} [cpn] - the client playback nonce of the playback to attest
 * @returns {Promise<{ poToken: string, attestationResponse: string | undefined }>}
 */
export default async function (videoId, context, initialAttestationData, ytConfig, cpn) {
  const requestKey = 'O43z0dpjhgX20SCx4KAo'

  let challengeData = initialAttestationData.R

  if (!challengeData.bgChallenge) {
    throw new Error('Failed to get BotGuard challenge')
  }

  let interpreterUrl = challengeData.bgChallenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue

  if (!interpreterUrl) {
    const challengeResponse = await fetch(
      'https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false&alt=json',
      {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Content-Type': 'application/json',
          'X-Goog-Visitor-Id': context.client.visitorData,
          'X-Youtube-Client-Version': context.client.clientVersion,
          'X-Youtube-Client-Name': '1'
        },
        body: JSON.stringify({
          engagementType: 'ENGAGEMENT_TYPE_UNBOUND',
          eacrToken: initialAttestationData.T,
          context
        }),
      }
    )

    if (!challengeResponse.ok) {
      throw new Error(`Request to ${challengeResponse.url} failed with status ${challengeResponse.status}\n${await challengeResponse.text()}`)
    }

    challengeData = await challengeResponse.json()

    if (!challengeData.bgChallenge) {
      throw new Error('Failed to get BotGuard challenge')
    }

    interpreterUrl = challengeData.bgChallenge.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
  }

  if (interpreterUrl.startsWith('//')) {
    interpreterUrl = `https:${interpreterUrl}`
  }

  const bgScriptResponse = await fetch(interpreterUrl)
  const interpreterJavascript = await bgScriptResponse.text()

  if (interpreterJavascript) {
    window.yt = { config_: ytConfig } // BotGuard reads the EVENT_ID field
    // eslint-disable-next-line no-new-func
    new Function(interpreterJavascript)()
  } else {
    throw new Error('Could not load VM.')
  }

  const botGuard = await BotGuardClient.create({
    program: challengeData.bgChallenge.program,
    globalName: challengeData.bgChallenge.globalName,
    globalObject: window
  })

  // The integrity token behind the PO token comes from the BotGuard program of the Waa/Create challenge for the
  // request key, the way YouTube's web player gets it. The att/get program above is kept for the playback attestation.
  const waaChallenge = await getChallenge({ fetchFunction: (input, init) => fetch(input, init), requestKey, useYouTubeAPI: true })

  let waaInterpreterJavascript = waaChallenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue
  if (!waaInterpreterJavascript && waaChallenge.interpreterUrl) {
    let waaInterpreterUrl = waaChallenge.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
    if (waaInterpreterUrl.startsWith('//')) {
      waaInterpreterUrl = `https:${waaInterpreterUrl}`
    }
    waaInterpreterJavascript = await (await fetch(waaInterpreterUrl)).text()
  }

  if (!waaInterpreterJavascript) {
    throw new Error('Could not load the Waa VM.')
  }

  // eslint-disable-next-line no-new-func
  new Function(waaInterpreterJavascript)()

  const poTokenBotGuard = await BotGuardClient.create({
    program: waaChallenge.program,
    globalName: waaChallenge.globalName,
    globalObject: window
  })

  const webPoSignalOutput = []
  const botGuardResponse = await poTokenBotGuard.snapshot({ webPoSignalOutput }, 10_000)

  const integrityTokenResponse = await fetch(buildURL('GenerateIT', true), {
    method: 'POST',
    headers: {
      'content-type': 'application/json+protobuf',
      'x-goog-api-key': GOOG_API_KEY,
      'x-user-agent': 'grpc-web-javascript/0.1',
    },
    body: JSON.stringify([requestKey, botGuardResponse])
  })

  const response = await integrityTokenResponse.json()

  if (typeof response[0] !== 'string') {
    throw new Error('Could not get integrity token')
  }

  const integrityTokenBasedMinter = await WebPoMinter.create({ integrityToken: response[0] }, webPoSignalOutput)

  const poToken = await integrityTokenBasedMinter.mintAsWebsafeString(videoId)

  // YouTube's web player attests each playback (ENGAGEMENT_TYPE_PLAYBACK) with a snapshot bound to the
  // attestation challenge, the client playback nonce and the video ID, and sends it to the playback tracking `atrUrl`.
  // Without it the streaming session stays "attestation pending" and stops serving media after about a minute.
  let attestationResponse
  if (cpn && challengeData.challenge) {
    try {
      const webResponse = await botGuard.snapshot({
        contentBinding: {
          c: challengeData.challenge,
          e: 'ENGAGEMENT_TYPE_PLAYBACK',
          cpn,
          encryptedVideoId: videoId,
        }
      }, 10_000)

      if (webResponse) {
        // Same format as the web player: the challenge, the response and, when the challenge asks for them (c6a, c6b),
        // the ad blocker reporting fields, the challenge timestamp XORed with the DCLKSTAT and CATSTAT config values
        const challengeParams = new URLSearchParams(challengeData.challenge)
        const timestamp = Number(challengeParams.get('c'))
        const parts = [challengeData.challenge, `r1a=${webResponse}`]

        if (challengeParams.has('c6a')) {
          parts.push(`r6a=${timestamp ^ (Number(ytConfig.DCLKSTAT) || 0)}`)
        }
        if (challengeParams.has('c6b')) {
          parts.push(`r6b=${timestamp ^ (Number(ytConfig.CATSTAT) || 0)}`)
        }

        attestationResponse = parts.join('&')
      }
    } catch (error) {
      console.error('Playback attestation snapshot failed', error)
    }
  }

  return { poToken, attestationResponse }
}
