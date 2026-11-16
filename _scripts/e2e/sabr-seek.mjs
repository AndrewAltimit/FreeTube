// Drives the running dev app (`pnpm run debug`) over the Chrome DevTools Protocol: opens a video, plays it,
// seeks past the first minute and reports what the SABR stream did, so playback fixes can be checked without
// someone at the keyboard. It talks to real YouTube from this machine, so keep runs few and far between.
//
// Usage: pnpm run e2e:sabr [-- --video <id>] [--seek <seconds>] [--play <seconds>] [--watch <seconds>]
//
// Exit code 0 means playback continued past the seek target without a player reload.

import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'

const { values: args } = parseArgs({
  // pnpm passes the `--` separator through
  args: process.argv.slice(2).filter(arg => arg !== '--'),
  options: {
    video: { type: 'string', default: 'aqz-KE-bpKQ' }, // Big Buck Bunny, 10 minutes
    seek: { type: 'string', default: '120' },
    play: { type: 'string', default: '8' },
    watch: { type: 'string', default: '30' },
    cdp: { type: 'string', default: 'http://127.0.0.1:9223' },
  },
})

const seekTo = Number(args.seek)
const playSeconds = Number(args.play)
const watchSeconds = Number(args.watch)

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

let browser
try {
  browser = await chromium.connectOverCDP(args.cdp)
} catch (error) {
  console.error(`Could not connect to ${args.cdp}. Start the app with \`pnpm run debug\` first.\n${error.message}`)
  process.exit(2)
}

const page = browser.contexts()
  .flatMap(context => context.pages())
  .find(p => p.url().startsWith('http://localhost:9080'))

if (!page) {
  console.error('No FreeTube window found (expected a page on http://localhost:9080)')
  process.exit(2)
}

/** @type {{ time: number, text: string }[]} */
const logs = []
const startedAt = Date.now()
const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1)

page.on('console', (message) => {
  const text = message.text()
  if (/\[SABR\]|SABR|attestation|PO token|poToken/i.test(text)) {
    logs.push({ time: elapsed(), text })
  }
})

console.log(`Opening ${args.video}`)
// Leave the watch page first: setting the hash to the current route wouldn't load the video again
await page.evaluate(() => { window.location.hash = '#/about' })
await sleep(1000)
await page.evaluate((id) => { window.location.hash = `#/watch/${id}` }, args.video)

const video = page.locator('video').first()
await video.waitFor({ state: 'attached', timeout: 60_000 })
await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, null, { timeout: 60_000 })

await video.evaluate((element) => {
  element.muted = true
  return element.play()
})
console.log(`Playing for ${playSeconds}s`)
await sleep(playSeconds * 1000)

const reloadsBeforeSeek = logs.filter(log => /requesting reload/.test(log.text)).length
console.log(`Seeking to ${seekTo}s`)
await video.evaluate((element, time) => { element.currentTime = time }, seekTo)

/** @type {number[]} */
const positions = []
for (let i = 0; i < watchSeconds; i++) {
  await sleep(1000)
  // The video element is replaced when the player reloads
  const position = await page.evaluate(() => document.querySelector('video')?.currentTime ?? NaN)
  positions.push(Math.round(position * 10) / 10)
}

const protectionStatuses = logs
  .map(log => log.text.match(/protection=(\d)/)?.[1])
  .filter(Boolean)
const reloads = logs.filter(log => /requesting reload/.test(log.text)).length
const http403 = logs.filter(log => /HTTP 403/.test(log.text)).length
const finalPosition = positions.at(-1)
const passed = reloads === 0 && finalPosition > seekTo + 5

console.log('\n--- SABR log')
for (const log of logs) {
  console.log(`${log.time.padStart(6)}s  ${log.text.split('\n')[0]}`)
}

console.log('\n--- Summary')
console.log(`protection statuses: ${protectionStatuses.join(' ') || '(none)'}`)
console.log(`reloads requested: ${reloads} (${reloadsBeforeSeek} before the seek)`)
console.log(`HTTP 403 responses: ${http403}`)
console.log(`position after seek, per second: ${positions.join(' ')}`)
console.log(passed ? 'PASS: playback continued past the seek target' : 'FAIL: playback did not continue past the seek target')

// Leaves the app running; only the CDP connection is closed
await browser.close()
process.exit(passed ? 0 : 1)
