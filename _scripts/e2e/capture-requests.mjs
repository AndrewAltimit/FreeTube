// Captures the /player request body and the first SABR (videoplayback POST) requests, decoded, for one video:
// either from YouTube's web player in a clean Chrome (--target web) or from the running dev app (--target freetube,
// needs `pnpm run debug`). Writes them to a JSON file so the two can be diffed field by field.
//
// Usage: node _scripts/e2e/capture-requests.mjs --target web|freetube --out <file> [--video <id>]

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import { VideoPlaybackAbrRequest } from 'googlevideo/protos'

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter(arg => arg !== '--'),
  options: {
    target: { type: 'string', default: 'web' },
    out: { type: 'string' },
    video: { type: 'string', default: 'aqz-KE-bpKQ' },
    sabrRequests: { type: 'string', default: '3' },
  },
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/** Uint8Arrays become their length and first bytes, so the shape is comparable without dumping secrets */
function summarise(value) {
  if (value instanceof Uint8Array) {
    return `<${value.length} bytes>`
  }
  if (Array.isArray(value)) {
    return value.map(summarise)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, summarise(v)]))
  }
  return value
}

const captured = { player: [], sabr: [], sabrUrl: null, atr: [], attestation: [] }
const maxSabr = Number(args.sabrRequests)

function onRequest(request) {
  const url = request.url()
  if (/\/api\/jnn\/|att\/get|api\/stats\/atr|\.googlevideo\.com\/videoplayback/.test(url) && captured.attestation.length < 12) {
    // allHeaders includes the cookies the network layer adds
    request.allHeaders().then(headers => captured.attestation.push({
      url: url.split('?')[0],
      hasCookie: 'cookie' in headers,
      cookieNames: (headers.cookie ?? '').split(';').map(c => c.split('=')[0].trim()).filter(Boolean),
      identityHeaders: Object.keys(headers).filter(name => /visitor|x-youtube|x-goog|authorization|origin|referer/i.test(name)),
    }))
  }
  if (url.includes('/api/stats/atr')) {
    const parsed = new URL(url)
    const body = request.postData() ?? ''
    const atr = new URLSearchParams(body).get('atr') ?? ''
    captured.atr.push({
      host: parsed.host,
      params: Object.fromEntries([...parsed.searchParams].map(([k, v]) => [k, k === 'cpn' || k === 'ei' ? `<${v.length} chars>` : v])),
      headers: Object.fromEntries(Object.entries(request.headers()).filter(([k]) => k !== 'cookie').map(([k, v]) => [k, k.startsWith('sec-ch') || k === 'user-agent' ? v : v.slice(0, 80)])),
      hasCookie: 'cookie' in request.headers(),
      bodyKeys: [...new URLSearchParams(body).keys()],
      atrShape: atr.split('&').map(part => part.replace(/=.*/s, (value) => `=<${value.length - 1} chars>`)),
    })
  }

  if (url.includes('/youtubei/v1/player') && request.method() === 'POST') {
    try {
      captured.player.push({ url: url.split('?')[0], headers: request.headers(), body: JSON.parse(request.postData()) })
    } catch {}
  } else if (url.includes('.googlevideo.com/videoplayback') && request.method() === 'POST' && captured.sabr.length < maxSabr) {
    const body = request.postDataBuffer()
    if (!body) return
    try {
      const decoded = VideoPlaybackAbrRequest.decode(new Uint8Array(body))
      captured.sabrUrl ??= { params: [...new URL(url).searchParams.keys()].sort(), headers: request.headers() }
      captured.sabr.push(summarise(decoded))
    } catch (error) {
      captured.sabr.push({ decodeError: error.message })
    }
  }
}

let cleanup
if (args.target === 'web') {
  const profileDir = await mkdtemp(join(tmpdir(), 'ft-yt-capture-'))
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  })
  context.on('request', onRequest)
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(`https://www.youtube.com/watch?v=${args.video}`)
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, null, { timeout: 60_000 })
  await page.evaluate(() => { const v = document.querySelector('video'); v.muted = true; return v.play().catch(() => {}) })
  cleanup = async () => {
    await context.close()
    await rm(profileDir, { recursive: true, force: true })
  }
} else {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
  const page = browser.contexts().flatMap(context => context.pages()).find(p => p.url().startsWith('http://localhost:9080'))
  page.on('request', onRequest)
  await page.evaluate(() => { window.location.hash = '#/about' })
  await sleep(1000)
  await page.evaluate((id) => { window.location.hash = `#/watch/${id}` }, args.video)
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, null, { timeout: 60_000 })
  await page.evaluate(() => { const v = document.querySelector('video'); v.muted = true; return v.play().catch(() => {}) })
  cleanup = () => browser.close()
}

for (let i = 0; i < 20 && captured.sabr.length < maxSabr; i++) {
  await sleep(1000)
}
await cleanup()

await writeFile(args.out, JSON.stringify(captured, null, 2))
console.log(`wrote ${args.out}: ${captured.player.length} /player requests, ${captured.sabr.length} SABR requests`)
