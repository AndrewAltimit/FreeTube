// Measures cold starts of the production bundles: launches the app through launch-packed.cjs against a
// throwaway profile, times process spawn to the subscription feed being drawn from cache, then quits.
// Build first with `pnpm run pack`. No other FreeTube instance from this repo may be running.
//
// Usage: FREETUBE_PERF_USER_DATA=<profile dir> node _scripts/perf/cold-start.mjs [--runs 5] [--settle 5000]
//
// Nothing attaches to the window while it starts: a DevTools session on the still-hidden, loading window
// can leave it unmounted. The script waits, then reads the timings the page recorded on its own: paint
// entries, and the first video thumbnail request as the moment the feed cards went into the document.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import electron from 'electron'

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter(arg => arg !== '--'),
  options: {
    runs: { type: 'string', default: '5' },
    port: { type: 'string', default: '9223' },
    settle: { type: 'string', default: '5000' },
  },
})

if (!process.env.FREETUBE_PERF_USER_DATA) {
  console.error('Set FREETUBE_PERF_USER_DATA to a profile directory')
  process.exit(2)
}

const launcher = fileURLToPath(new URL('./launch-packed.cjs', import.meta.url))
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function findPageTarget(deadline) {
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${args.port}/json/list`)).json()
      const page = targets.find(target => target.type === 'page' && target.url.startsWith('app://'))
      if (page) { return page }
    } catch {}
    await sleep(10)
  }
  throw new Error('Timed out waiting for the FreeTube window')
}

/** Evaluates an expression in the page over a raw CDP socket and returns its value */
async function evaluate(target, expression) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  const response = await new Promise((resolve) => {
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id === 1) { resolve(message) }
    }
    socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }))
  })
  socket.close()
  if (response.result.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text)
  }
  return response.result.result.value
}

const TIMINGS = `(async () => {
  const buffered = (type) => new Promise((resolve) => {
    const observer = new PerformanceObserver((list) => { observer.disconnect(); resolve(list.getEntries()) })
    observer.observe({ type, buffered: true })
    setTimeout(() => resolve([]), 200)
  })
  const [nav] = performance.getEntriesByType('navigation')
  const fcp = (await buffered('paint')).find(entry => entry.name === 'first-contentful-paint')
  const lcp = (await buffered('largest-contentful-paint')).at(-1)
  const thumbnail = performance.getEntriesByType('resource').find(entry => entry.name.includes('/vi/') || entry.name.includes('/vi_webp/'))
  return {
    timeOrigin: performance.timeOrigin,
    domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
    fcp: fcp ? fcp.startTime : null,
    lcp: lcp ? lcp.startTime : null,
    feedAt: thumbnail ? thumbnail.startTime : null,
    cards: document.querySelectorAll('.ft-list-video, .ft-list-post').length,
  }
})()`

const results = []
for (let i = 0; i < Number(args.runs); i++) {
  const spawnedAt = Date.now()
  const child = spawn(electron, [launcher, `--remote-debugging-port=${args.port}`], { stdio: 'ignore' })
  const exited = new Promise(resolve => child.once('exit', resolve))

  let timing
  try {
    const target = await findPageTarget(spawnedAt + 60_000)
    // Comfortably past startup on this machine; the timings are recorded by the page, not by this wait
    await sleep(Number(args.settle))
    timing = await evaluate(target, TIMINGS)
  } finally {
    child.kill()
    await exited
  }

  if (!timing?.cards) {
    console.error(`cold start ${i + 1}: the feed was not drawn within ${args.settle} ms`)
    process.exit(1)
  }

  const run = {
    rendererStart: timing.timeOrigin - spawnedAt,
    domContentLoaded: timing.timeOrigin + timing.domContentLoaded - spawnedAt,
    firstContentfulPaint: timing.fcp == null ? null : timing.timeOrigin + timing.fcp - spawnedAt,
    feedCards: timing.feedAt == null ? null : timing.timeOrigin + timing.feedAt - spawnedAt,
    largestContentfulPaint: timing.lcp == null ? null : timing.timeOrigin + timing.lcp - spawnedAt,
  }
  results.push(run)
  console.log(`cold start ${i + 1}: ${Object.entries(run).map(([key, value]) => `${key} ${value == null ? 'n/a' : value.toFixed(0)}`).join(', ')} ms`)

  await sleep(1500)
}

const median = (values) => {
  const sorted = values.filter(value => value != null).sort((a, b) => a - b)
  return sorted.length === 0 ? 'n/a' : sorted[Math.floor(sorted.length / 2)].toFixed(0)
}
console.log(`
Medians (ms after spawn): ${Object.keys(results[0]).map(key => `${key} ${median(results.map(run => run[key]))}`).join(', ')}`)
