// Profiles the running dev app (`pnpm run debug`) over the Chrome DevTools Protocol: how long the renderer
// takes to boot and draw the subscription feed from cache, how long switching back to the feed and loading
// more of it takes, and how much memory the renderer and main process hold afterwards.
//
// It makes no YouTube requests of its own, but the feed shows thumbnails. For numbers that don't depend on
// the network, run the app against a profile with automatic subscription fetching turned off, for example:
//   FREETUBE_DEV_USER_DATA=<copy of FreeTube-dev> pnpm run debug
//
// Usage: node _scripts/perf/feed-profile.mjs [--runs 5] [--load-more 5] [--json out.json]
//
// The numbers come from a development build (unminified, served by webpack-dev-server), so compare runs
// against each other rather than against a packaged build.

import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter(arg => arg !== '--'),
  options: {
    runs: { type: 'string', default: '5' },
    'load-more': { type: 'string', default: '5' },
    cdp: { type: 'string', default: 'http://127.0.0.1:9223' },
    // the dev server; a packaged build loads the renderer from file://
    url: { type: 'string', default: 'http://localhost:9080' },
    inspector: { type: 'string', default: 'http://127.0.0.1:9222' },
    json: { type: 'string' },
  },
})

const runs = Number(args.runs)
const loadMoreClicks = Number(args['load-more'])
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const CARD_SELECTOR = '.ft-list-video, .ft-list-post'

let browser
try {
  browser = await chromium.connectOverCDP(args.cdp)
} catch (error) {
  console.error(`Could not connect to ${args.cdp}. Start the app with \`pnpm run debug\` first.\n${error.message}`)
  process.exit(2)
}

const page = browser.contexts()
  .flatMap(context => context.pages())
  .find(p => p.url().startsWith(args.url))

if (!page) {
  console.error(`No FreeTube window found (expected a page on ${args.url})`)
  process.exit(2)
}

const cdp = await page.context().newCDPSession(page)
await cdp.send('Performance.enable')
await cdp.send('Page.enable')

// Collect long tasks from the very start of each document
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__ftPerf = { longTasks: [] }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__ftPerf.longTasks.push({ start: entry.startTime, duration: entry.duration })
        }
      }).observe({ type: 'longtask', buffered: true })
    } catch {}
  `,
})

async function metrics() {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]))
}

/** Polls in the page until the feed shows cards and the store says the cache is ready */
function waitForFeed(minCards = 1, timeout = 30_000) {
  return page.evaluate(async ({ selector, minCards, timeout }) => {
    const store = () => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store
    const deadline = performance.now() + timeout
    let cacheReadyAt = null
    while (performance.now() < deadline) {
      if (cacheReadyAt === null && store()?.getters.getSubscriptionCacheReady) {
        cacheReadyAt = performance.now()
      }
      const cards = document.querySelectorAll(selector).length
      if (cards >= minCards) {
        // Wait for the frame that paints them
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
        return { cacheReadyAt, feedAt: performance.now(), cards }
      }
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    return { cacheReadyAt, feedAt: null, cards: document.querySelectorAll(selector).length }
  }, { selector: CARD_SELECTOR, minCards, timeout })
}

function longTaskSummary(since = 0) {
  return page.evaluate((since) => {
    const tasks = (window.__ftPerf?.longTasks ?? []).filter(task => task.start >= since)
    return {
      count: tasks.length,
      totalMs: tasks.reduce((sum, task) => sum + task.duration, 0),
      maxMs: tasks.reduce((max, task) => Math.max(max, task.duration), 0),
    }
  }, since)
}

async function mainProcessMemory() {
  try {
    const [target] = await (await fetch(`${args.inspector}/json/list`)).json()
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    const result = await new Promise((resolve) => {
      socket.onmessage = (event) => resolve(JSON.parse(event.data))
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: 'JSON.stringify(process.memoryUsage())', returnByValue: true },
      }))
    })
    socket.close()
    return JSON.parse(result.result.result.value)
  } catch {
    return null
  }
}

const median = (values) => {
  const sorted = values.filter(value => value != null).sort((a, b) => a - b)
  return sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)]
}
const mb = (bytes) => bytes == null ? 'n/a' : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const ms = (value) => value == null ? 'n/a' : `${value.toFixed(0)} ms`

async function goTo(hash) {
  await page.evaluate((hash) => { window.location.hash = hash }, hash)
}

// 1. Cold renderer boot: reload the window, landing page is the subscription feed
const boot = []
for (let i = 0; i < runs; i++) {
  await goTo('#/subscriptions')
  await page.reload({ waitUntil: 'commit' })
  const { cacheReadyAt, feedAt, cards } = await waitForFeed()
  const nav = await page.evaluate(() => {
    const [entry] = performance.getEntriesByType('navigation')
    return { domContentLoaded: entry?.domContentLoadedEventEnd, load: entry?.loadEventEnd }
  })
  await sleep(1500)
  const longTasks = await longTaskSummary()
  boot.push({ ...nav, cacheReadyAt, feedAt, cards, longTasks })
  console.log(`boot ${i + 1}: DOMContentLoaded ${ms(nav.domContentLoaded)}, cache ready ${ms(cacheReadyAt)}, feed drawn ${ms(feedAt)} (${cards} cards), long tasks ${longTasks.count} / ${ms(longTasks.totalMs)} (max ${ms(longTasks.maxMs)})`)
}

// 2. Switching back to the feed from another view (cache already in the store)
const revisit = []
for (let i = 0; i < runs; i++) {
  await goTo('#/settings')
  await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 0, CARD_SELECTOR)
  await sleep(300)
  const start = await page.evaluate(() => performance.now())
  await goTo('#/subscriptions')
  const { feedAt, cards } = await waitForFeed()
  await sleep(500)
  const longTasks = await longTaskSummary(start)
  revisit.push({ ms: feedAt - start, cards, longTasks })
  console.log(`revisit ${i + 1}: feed drawn in ${ms(feedAt - start)} (${cards} cards), long tasks ${longTasks.count} / ${ms(longTasks.totalMs)}`)
}

// 3. Loading more of the feed
const loadMore = []
for (let i = 0; i < loadMoreClicks; i++) {
  const before = await page.locator(CARD_SELECTOR).count()
  const button = page.locator('.ft-auto-load-next-page-wrapper button, button:has-text("Load More")').last()
  if (await button.count() === 0) { break }
  const start = await page.evaluate(() => performance.now())
  await button.click()
  const { feedAt, cards } = await waitForFeed(before + 1)
  await sleep(300)
  const longTasks = await longTaskSummary(start)
  loadMore.push({ ms: feedAt - start, cards, longTasks })
  console.log(`load more ${i + 1}: ${before} -> ${cards} cards in ${ms(feedAt - start)}, long tasks ${longTasks.count} / ${ms(longTasks.totalMs)}`)
}

// Collect garbage first, so the heap and node counts are what the page holds on to
await cdp.send('HeapProfiler.collectGarbage')
await sleep(500)
const renderer = await metrics()
const liveNodes = await page.evaluate(() => document.getElementsByTagName('*').length)
const main = await mainProcessMemory()

const summary = {
  boot: {
    domContentLoaded: median(boot.map(run => run.domContentLoaded)),
    cacheReady: median(boot.map(run => run.cacheReadyAt)),
    feedDrawn: median(boot.map(run => run.feedAt)),
    longTaskMs: median(boot.map(run => run.longTasks.totalMs)),
  },
  revisit: {
    feedDrawn: median(revisit.map(run => run.ms)),
    longTaskMs: median(revisit.map(run => run.longTasks.totalMs)),
  },
  loadMore: {
    perClick: median(loadMore.map(run => run.ms)),
    finalCards: loadMore.at(-1)?.cards ?? null,
  },
  renderer: { jsHeapUsed: renderer.JSHeapUsedSize, domNodes: renderer.Nodes, liveElements: liveNodes, documents: renderer.Documents },
  main,
}

console.log('\nMedians')
console.log(`  boot:      DOMContentLoaded ${ms(summary.boot.domContentLoaded)}, cache ready ${ms(summary.boot.cacheReady)}, feed drawn ${ms(summary.boot.feedDrawn)}, long tasks ${ms(summary.boot.longTaskMs)}`)
console.log(`  revisit:   feed drawn ${ms(summary.revisit.feedDrawn)}, long tasks ${ms(summary.revisit.longTaskMs)}`)
console.log(`  load more: ${ms(summary.loadMore.perClick)} per click, ${summary.loadMore.finalCards ?? 'n/a'} cards at the end`)
console.log(`  renderer:  JS heap ${mb(summary.renderer.jsHeapUsed)}, ${summary.renderer.domNodes} DOM nodes (${summary.renderer.liveElements} elements in the document), ${summary.renderer.documents} documents`)
console.log(`  main:      ${main ? `heap ${mb(main.heapUsed)}, rss ${mb(main.rss)}` : 'inspector not reachable'}`)

if (args.json) {
  writeFileSync(args.json, JSON.stringify({ summary, boot, revisit, loadMore }, null, 2))
}

await browser.close()
