// Drives the running dev app (`pnpm run debug`) over the Chrome DevTools Protocol: opens a live stream and reports
// how shaka-player sees it (manifest type, seek range, live delay, buffer ahead of the playhead) and every stall
// during the watch window. It talks to real YouTube from this machine, so keep runs few and far between.
//
// Usage: pnpm run e2e:live -- --video <id> [--watch <seconds>] [--rewind <seconds>] [--offline <seconds>]
//
// Half way through the watch window, --rewind seeks that many seconds behind the live edge, to check that the
// DVR window is reachable, and --offline cuts the network for that many seconds, to check that the buffer
// carries playback through a hiccup. Exit code 0 means the stream played with less than a second of total stall time.

import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'

const { values: args } = parseArgs({
  // pnpm passes the `--` separator through
  args: process.argv.slice(2).filter(arg => arg !== '--'),
  options: {
    video: { type: 'string' },
    watch: { type: 'string', default: '60' },
    rewind: { type: 'string', default: '0' },
    offline: { type: 'string', default: '0' },
    cdp: { type: 'string', default: 'http://127.0.0.1:9223' },
  },
})

if (!args.video) {
  console.error('Pass the ID of a stream that is live right now with --video <id>')
  process.exit(2)
}

const watchSeconds = Number(args.watch)
const rewindSeconds = Number(args.rewind)
const offlineSeconds = Number(args.offline)

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

const startedAt = Date.now()
const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1)

/** @type {{ time: string, url: string }[]} */
const manifests = []
page.on('request', (request) => {
  const url = request.url()
  if (/\/api\/manifest\/(dash|hls)/.test(url)) {
    manifests.push({ time: elapsed(), url })
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

// Counts stalls on the page side, so short ones between samples are not missed
await page.evaluate(() => {
  const element = document.querySelector('video')
  window.__liveProbe = { stalls: [], stalledSince: null }
  element.addEventListener('waiting', () => {
    window.__liveProbe.stalledSince = performance.now()
  })
  element.addEventListener('playing', () => {
    const probe = window.__liveProbe
    if (probe.stalledSince !== null) {
      probe.stalls.push({ at: element.currentTime, ms: Math.round(performance.now() - probe.stalledSince) })
      probe.stalledSince = null
    }
  })
  element.muted = true
  return element.play()
})

const sample = () => page.evaluate(() => {
  const element = document.querySelector('video')
  const player = element?.ui?.getControls()?.getPlayer()
  if (!player) {
    return null
  }

  const { start, end } = player.seekRange()
  const timeline = player.getManifest?.()?.presentationTimeline
  let bufferAhead = 0
  for (let i = 0; i < element.buffered.length; i++) {
    if (element.buffered.start(i) <= element.currentTime && element.buffered.end(i) >= element.currentTime) {
      bufferAhead = element.buffered.end(i) - element.currentTime
    }
  }

  return {
    isLive: player.isLive(),
    loadMode: player.getLoadMode?.(),
    assetUri: player.getAssetUri(),
    current: element.currentTime,
    seekStart: start,
    seekEnd: end,
    behindEdge: end - element.currentTime,
    bufferAhead,
    delay: timeline?.getDelay?.(),
    segmentAvailabilityDuration: timeline?.getSegmentAvailabilityDuration?.(),
    maxSegmentDuration: timeline?.getMaxSegmentDuration?.(),
    config: player.getConfiguration().streaming.liveSync,
    rebufferingGoal: player.getConfiguration().streaming.rebufferingGoal,
    stats: player.getStats(),
  }
})

const first = await sample()
if (!first) {
  console.error('No shaka-player instance found on the video element')
  process.exit(2)
}

console.log('\n--- Player')
console.log(`isLive: ${first.isLive}`)
console.log(`asset: ${first.assetUri.slice(0, 140)}...`)
console.log(`seek range: ${first.seekStart.toFixed(1)} - ${first.seekEnd.toFixed(1)} (${(first.seekEnd - first.seekStart).toFixed(0)}s wide)`)
console.log(`presentation delay: ${first.delay}, segment availability duration: ${first.segmentAvailabilityDuration}, max segment duration: ${first.maxSegmentDuration}`)
console.log(`rebufferingGoal: ${first.rebufferingGoal}`)

console.log('\n--- Samples (t, behind live edge, buffer ahead, seek range width)')
const rows = []
for (let i = 0; i < watchSeconds; i++) {
  await sleep(1000)
  if (rewindSeconds > 0 && i === Math.floor(watchSeconds / 2)) {
    console.log(`Seeking ${rewindSeconds}s behind the live edge`)
    await page.evaluate((seconds) => {
      const element = document.querySelector('video')
      const player = element.ui.getControls().getPlayer()
      element.currentTime = Math.max(player.seekRange().start, player.seekRange().end - seconds)
    }, rewindSeconds)
  }
  if (offlineSeconds > 0 && i === Math.floor(watchSeconds / 2)) {
    console.log(`Cutting the network for ${offlineSeconds}s`)
    await page.context().setOffline(true)
    setTimeout(() => page.context().setOffline(false).then(() => console.log('Network back')), offlineSeconds * 1000)
  }
  const s = await sample()
  if (s) {
    rows.push(s)
    console.log(`${elapsed().padStart(6)}s  behind=${s.behindEdge.toFixed(1)}s  ahead=${s.bufferAhead.toFixed(1)}s  window=${(s.seekEnd - s.seekStart).toFixed(0)}s`)
  }
}

const probe = await page.evaluate(() => window.__liveProbe)
const totalStallMs = probe.stalls.reduce((sum, stall) => sum + stall.ms, 0)

console.log('\n--- Summary')
console.log(`manifest requests: ${manifests.length}`)
for (const manifest of manifests.slice(0, 3)) {
  console.log(`  ${manifest.time}s ${manifest.url.slice(0, 160)}`)
}
console.log(`stalls: ${probe.stalls.length} totalling ${totalStallMs}ms ${JSON.stringify(probe.stalls)}`)
console.log(`still stalled at the end: ${probe.stalledSince !== null}`)
const last = rows.at(-1)
if (last) {
  console.log(`final: behind=${last.behindEdge.toFixed(1)}s ahead=${last.bufferAhead.toFixed(1)}s dropped=${last.stats.droppedFrames} stateHistory=${JSON.stringify(last.stats.stateHistory.slice(-6))}`)
}

const passed = totalStallMs < 1000 && probe.stalledSince === null
console.log(passed ? 'PASS: no meaningful stalls' : 'FAIL: playback stalled')

// Leaves the app running; only the CDP connection is closed
await browser.close()
process.exit(passed ? 0 : 1)
