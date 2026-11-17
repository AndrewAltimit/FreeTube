// Baseline for SABR investigations: plays a video in YouTube's own web player, in the installed Chrome with a fresh
// temporary profile (no cookies, no sign-in), and decodes the stream protection status from the SABR responses.
// If YouTube's own player is also stuck at status 2 ("attestation pending") from this machine, the problem is the
// network or IP, not FreeTube. Opens a visible Chrome window, as headless Chrome is treated differently by BotGuard.
//
// With --block-atr, the player's attestation ping (/api/stats/atr) is dropped, to see whether the stream still leaves
// "attestation pending" without it.
//
// Usage: node _scripts/e2e/youtube-web-baseline.mjs [--video <id>] [--seek <seconds>] [--play <seconds>] [--watch <seconds>] [--block-atr]

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import { UmpReader, CompositeBuffer } from 'googlevideo/ump'
import { concatenateChunks } from 'googlevideo/utils'
import { UMPPartId, StreamProtectionStatus, VideoPlaybackAbrRequest } from 'googlevideo/protos'

const { values: args } = parseArgs({
  // pnpm passes the `--` separator through
  args: process.argv.slice(2).filter(arg => arg !== '--'),
  options: {
    video: { type: 'string', default: 'aqz-KE-bpKQ' },
    seek: { type: 'string', default: '120' },
    play: { type: 'string', default: '8' },
    watch: { type: 'string', default: '30' },
    'block-atr': { type: 'boolean', default: false },
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

const profileDir = await mkdtemp(join(tmpdir(), 'ft-yt-baseline-'))
const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1280, height: 800 },
  // Without these, navigator.webdriver is true and the window says it is controlled by automated software,
  // both of which BotGuard can see
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled'],
})

if (args['block-atr']) {
  await context.route('**/api/stats/atr*', (route) => {
    console.log(`${elapsed()}s  blocked ${route.request().url().split('?')[0]}`)
    return route.abort()
  })
}

/** @type {string[]} */
const statuses = []
let lastPoTokenLength = -1

context.on('request', (request) => {
  const url = request.url()
  if (/att\/get|\/Create|GenerateIT|api\/stats\/atr|\/youtubei\/v1\/player/.test(url)) {
    console.log(`${elapsed()}s  -> ${request.method()} ${url.split('?')[0]}`)
  }

  if (url.includes('.googlevideo.com/videoplayback') && request.method() === 'POST') {
    const body = request.postDataBuffer()
    if (body) {
      try {
        const abrRequest = VideoPlaybackAbrRequest.decode(new Uint8Array(body))
        const ctx = abrRequest.streamerContext ?? {}
        const keys = Object.keys(ctx).filter(key => ctx[key] != null && !(Array.isArray(ctx[key]) && ctx[key].length === 0))
        if (statuses.length === 0) {
          console.log(`${elapsed()}s     first SABR request: poToken ${ctx.poToken?.length ?? 0} bytes, streamerContext fields: ${keys.join(', ')}`)
        }
        if ((ctx.poToken?.length ?? 0) !== lastPoTokenLength) {
          lastPoTokenLength = ctx.poToken?.length ?? 0
          console.log(`${elapsed()}s     SABR requests now carry a ${lastPoTokenLength}-byte poToken`)
        }
      } catch {}
    }
  }
})

context.on('response', async (response) => {
  const url = response.url()
  if (/att\/get|\/Create|GenerateIT|api\/stats\/atr|\/youtubei\/v1\/player/.test(url)) {
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

  if (found.length) {
    statuses.push(...found)
    console.log(`${elapsed()}s     SABR response HTTP ${response.status()} protection=${found.join(',')}`)
  }
})

try {
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(`https://www.youtube.com/watch?v=${args.video}`)

  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, null, { timeout: 60_000 })
  await page.evaluate(() => {
    const video = document.querySelector('video')
    video.muted = true
    return video.play().catch(() => {})
  })
  await sleep(Number(args.play) * 1000)

  console.log(`${elapsed()}s  seeking to ${args.seek}s`)
  await page.evaluate((time) => {
    const player = document.querySelector('#movie_player')
    if (player?.seekTo) {
      player.seekTo(time, true)
    } else {
      document.querySelector('video').currentTime = time
    }
  }, Number(args.seek))

  const positions = []
  for (let i = 0; i < Number(args.watch); i++) {
    await sleep(1000)
    positions.push(await page.evaluate(() => Math.round((document.querySelector('video')?.currentTime ?? NaN) * 10) / 10))
  }

  console.log('\n--- Summary')
  console.log(`protection statuses: ${statuses.join(' ') || '(none decoded)'}`)
  console.log(`position after seek, per second: ${positions.join(' ')}`)
} finally {
  await context.close()
  await rm(profileDir, { recursive: true, force: true })
}
