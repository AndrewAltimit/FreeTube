// Token transplant test: plays a video in YouTube's own web player (installed Chrome, fresh profile, no automation
// markers) and rewrites the PO token in its SABR requests, to tell a bad token from a bad session.
//   --mode control   decode and re-encode the SABR requests without changes (checks the rewrite itself is harmless)
//   --mode freetube  replace the web player's PO token with one minted by FreeTube's dist/botGuardScript.js, run in a
//                    youtube.com page of the same browser context (same visitor cookies), from the watch page's own
//                    attestation challenge and ytcfg
//
// Usage: node _scripts/e2e/token-transplant.mjs --mode control|freetube [--video <id>] [--seek <s>] [--play <s>] [--watch <s>]

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import { UmpReader, CompositeBuffer } from 'googlevideo/ump'
import { base64ToU8, concatenateChunks } from 'googlevideo/utils'
import { UMPPartId, StreamProtectionStatus, VideoPlaybackAbrRequest } from 'googlevideo/protos'

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter(arg => arg !== '--'),
  options: {
    mode: { type: 'string', default: 'freetube' },
    // where FreeTube's script runs: 'watch' (the watch page itself) or 'blank' (robots.txt of the same origin)
    mintIn: { type: 'string', default: 'watch' },
    video: { type: 'string', default: 'aqz-KE-bpKQ' },
    seek: { type: 'string', default: '120' },
    play: { type: 'string', default: '8' },
    watch: { type: 'string', default: '20' },
  },
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const startedAt = Date.now()
const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1).padStart(6)

function decodePart(part, decoder) {
  if (!part.data.chunks.length) return undefined
  try {
    const chunk = part.data.chunks.length === 1 ? part.data.chunks[0] : concatenateChunks(part.data.chunks)
    return decoder.decode(chunk)
  } catch {
    return undefined
  }
}

function parseLooseJson(text) {
  // ytAtN's argument is a JS object literal with \x escapes; evaluate it as JSON after unescaping
  // eslint-disable-next-line no-new-func
  return new Function(`return (${text})`)()
}

const botGuardScript = await readFile(new URL('../../dist/botGuardScript.js', import.meta.url), 'utf-8')
const exportMatch = botGuardScript.match(/export{(\w+) as default};/)

const profileDir = await mkdtemp(join(tmpdir(), 'ft-yt-transplant-'))
const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1280, height: 800 },
  bypassCSP: true,
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled'],
})

await context.route('https://www.google.com/js/**', async (route) => {
  const response = await route.fetch()
  await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } })
})

/** @type {Promise<Uint8Array> | null} */
let tokenPromise = null
let resolveHtml
const htmlPromise = new Promise(resolve => { resolveHtml = resolve })

// The minting page: same context, so the same visitor cookies as the watch page
const mintPage = await context.newPage()
await mintPage.goto('https://www.youtube.com/robots.txt')

// The inline ytcfg and ytAtN scripts stay in the DOM (route.fetch can't parse the watch page's huge headers)
context.pages()[0].once('domcontentloaded', async (loadedPage) => {
  resolveHtml(await loadedPage.content())
})

if (args.mode === 'freetube') {
  tokenPromise = htmlPromise.then(async (html) => {
    const ytcfgText = html.match(/ytcfg\.set\(({.+?})\);/s)?.[1]
    const atnText = html.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/)?.[1]
    if (!ytcfgText || !atnText) throw new Error('ytcfg or ytAtN missing from the watch page')

    const ytConfig = JSON.parse(ytcfgText)
    const initialAttestationData = parseLooseJson(atnText)
    if (typeof initialAttestationData.R === 'string') {
      initialAttestationData.R = JSON.parse(initialAttestationData.R)
    }
    const ytContext = ytConfig.INNERTUBE_CONTEXT

    const script = botGuardScript.replace(exportMatch[0],
      `;return ${exportMatch[1]}(${JSON.stringify(args.video)},${JSON.stringify(ytContext)},${JSON.stringify(initialAttestationData)},${JSON.stringify(ytConfig)},null)`)
    const targetPage = args.mintIn === 'watch' ? context.pages()[0] : mintPage
    const result = await targetPage.evaluate(`(async () => { ${script} })()`)
    const poToken = typeof result === 'string' ? result : result.poToken
    console.log(`${elapsed()}s  minted FreeTube token: ${poToken.length} chars`)
    return base64ToU8(poToken)
  })
  tokenPromise.catch(error => console.error('minting failed', error))
}

let rewritten = 0
await context.route('https://*.googlevideo.com/videoplayback*', async (route) => {
  const request = route.request()
  const body = request.postDataBuffer()
  if (request.method() !== 'POST' || !body) return route.continue()

  let abrRequest
  try {
    abrRequest = VideoPlaybackAbrRequest.decode(new Uint8Array(body))
  } catch {
    return route.continue()
  }

  const originalLength = abrRequest.streamerContext?.poToken?.length ?? 0
  if (tokenPromise) {
    const token = await tokenPromise
    abrRequest.streamerContext.poToken = token
  }

  const encoded = VideoPlaybackAbrRequest.encode(abrRequest).finish()
  if (rewritten++ < 3) {
    console.log(`${elapsed()}s  SABR request: original poToken ${originalLength} bytes, sent ${abrRequest.streamerContext?.poToken?.length ?? 0} bytes, body ${body.length} -> ${encoded.length} bytes`)
  }
  await route.continue({ postData: Buffer.from(encoded) })
})

/** @type {number[]} */
const statuses = []
context.on('response', async (response) => {
  const url = response.url()
  if (/api\/jnn|api\/stats\/atr/.test(url)) {
    console.log(`${elapsed()}s  <- ${response.status()} ${url.split('?')[0]}`)
  }
  if (!url.includes('.googlevideo.com/videoplayback') || response.request().method() !== 'POST') return

  let body
  try {
    body = new Uint8Array(await response.body())
  } catch {
    return
  }
  const found = []
  new UmpReader(new CompositeBuffer([body])).read((part) => {
    if (part.type === UMPPartId.STREAM_PROTECTION_STATUS) {
      const status = decodePart(part, StreamProtectionStatus)
      if (status) found.push(status.status)
    }
  })
  statuses.push(...found)
})

try {
  const page = context.pages()[0]
  await page.goto(`https://www.youtube.com/watch?v=${args.video}`)
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, null, { timeout: 90_000 })
  await page.evaluate(() => {
    const video = document.querySelector('video')
    video.muted = true
    return video.play().catch(() => {})
  })
  await sleep(Number(args.play) * 1000)

  console.log(`${elapsed()}s  seeking to ${args.seek}s`)
  await page.evaluate((time) => document.querySelector('#movie_player')?.seekTo(time, true), Number(args.seek))

  const positions = []
  for (let i = 0; i < Number(args.watch); i++) {
    await sleep(1000)
    positions.push(await page.evaluate(() => Math.round((document.querySelector('video')?.currentTime ?? NaN) * 10) / 10))
  }

  console.log(`\n--- ${args.mode}`)
  console.log(`protection statuses: ${statuses.join(' ') || '(none decoded)'}`)
  console.log(`position after seek, per second: ${positions.join(' ')}`)
} finally {
  await context.close()
  await rm(profileDir, { recursive: true, force: true })
}
