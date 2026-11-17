// Regenerates the README screenshots from the running dev app, so they show this fork's default settings.
// Start the app on a fresh, throwaway profile first, so no personal data ends up in the images:
//
//   FREETUBE_DEV_USER_DATA=<empty temp dir> pnpm run debug
//   node _scripts/e2e/screenshots.mjs [--config _scripts/e2e/screenshots.config.json] [--out .github/screenshots]
//
// It subscribes the profile to the channels in the config, then captures the subscriptions feed, a watch page (the
// config's video, at videoTimeSeconds) and the settings.
// It talks to real YouTube from this machine, so keep runs few.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter(arg => arg !== '--'),
  options: {
    config: { type: 'string', default: fileURLToPath(new URL('screenshots.config.json', import.meta.url)) },
    out: { type: 'string', default: '.github/screenshots' },
    cdp: { type: 'string', default: 'http://127.0.0.1:9223' },
  },
})

/** @type {{ channels: { id: string, name: string }[], video: string, videoTimeSeconds: number }} */
const config = JSON.parse(await readFile(args.config, 'utf-8'))

const WIDTH = 1280
const HEIGHT = 800

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const browser = await chromium.connectOverCDP(args.cdp)
const page = browser.contexts()
  .flatMap(context => context.pages())
  .find(p => p.url().startsWith('http://localhost:9080'))

if (!page) {
  console.error('No FreeTube window found (expected a page on http://localhost:9080). Start it with `pnpm run debug`.')
  process.exit(2)
}

// DevTools are docked in dev mode, so pin the page's size instead of relying on the window's
const cdp = await page.context().newCDPSession(page)
await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
// A hidden or covered window stops painting, and screenshots then wait forever
await cdp.send('Page.bringToFront')

async function go(hash) {
  // Leave the route first: setting the hash to the current route doesn't reload the view
  await page.evaluate(() => { window.location.hash = '#/about' })
  await sleep(500)
  await page.evaluate((h) => { window.location.hash = h }, hash)
}

async function capture(name, { hover } = {}) {
  const path = join(args.out, name)
  if (hover) {
    // Move the mouse rather than locator.hover(): the player's overlay covers the element itself
    const box = await page.locator(hover).first().boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  } else {
    // Move the mouse out of the way so no hover state shows
    await page.mouse.move(WIDTH - 1, HEIGHT - 1)
  }
  await sleep(500)
  // Straight through CDP: Playwright's page.screenshot waits for a new frame, which a docked-DevTools Electron
  // window doesn't always produce
  await cdp.send('Page.bringToFront')
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(path, Buffer.from(data, 'base64'))
  console.log(`wrote ${path}`)
}

await mkdir(args.out, { recursive: true })

for (const { id: channelId } of config.channels) {
  await go(`#/channel/${channelId}`)
  // Wait for this channel's page, not the previous one's
  await page.waitForFunction((id) => window.location.hash.includes(id), channelId)
  await sleep(3000)
  const button = page.locator('.subscribeButton, button:has-text("Subscribe")').first()
  await button.waitFor({ timeout: 60_000 })
  const name = await page.locator('.channelName, h1').first().textContent().catch(() => '?')
  const label = (await button.textContent()).trim()
  if (/^Subscribe/i.test(label)) {
    await button.click()
    console.log(`subscribed to ${name?.trim()} (${channelId})`)
  } else {
    console.log(`already subscribed to ${name?.trim()} (${channelId})`)
  }
  await sleep(1500)
}

await go('#/subscriptions')
await page.locator('.ft-list-video, .videoThumbnail, .ft-list-item').first().waitFor({ timeout: 90_000 })
// Let the thumbnails load
await page.waitForFunction(() => [...document.images].filter(img => img.offsetParent).every(img => img.complete), null, { timeout: 30_000 }).catch(() => {})
await sleep(2000)
await capture('subscriptions.png')

await go(`#/watch/${config.video}`)
await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, null, { timeout: 60_000 })
await page.evaluate(async (time) => {
  const video = document.querySelector('video')
  video.muted = true
  // A frame from the middle of the video, rather than the title card
  video.currentTime = time
  await video.play()
}, config.videoTimeSeconds)
await sleep(4000)
await page.evaluate(() => document.querySelector('video').pause())
await page.waitForFunction(() => [...document.images].filter(img => img.offsetParent).every(img => img.complete), null, { timeout: 30_000 }).catch(() => {})
await sleep(1000)
// Hovering the player shows its controls
await capture('watch.png', { hover: 'video' })

await go('#/settings')
await sleep(3000)
await capture('settings.png')

await cdp.send('Emulation.clearDeviceMetricsOverride')
// Leaves the app running; only the CDP connection is closed
await browser.close()
