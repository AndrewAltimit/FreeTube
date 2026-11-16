// Development-only oracle: runs FreeTube's compiled BotGuard script (dist/botGuardScript.js) in a youtube.com page in
// the installed Chrome, with a fresh profile and without the automation markers, and serves the results over HTTP on
// 127.0.0.1. Start the dev app with FREETUBE_POTOKEN_SERVER=http://127.0.0.1:9230 to use these tokens instead of the
// Electron sandbox's, which shows whether a SABR problem is the sandbox environment or something else.
//
// Usage: node _scripts/e2e/chrome-potoken-server.mjs   (needs `pnpm run pack:botGuardScript` or a dev run first)

import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const PORT = 9230

const scriptContent = await readFile(new URL('../../dist/botGuardScript.js', import.meta.url), 'utf-8')
const exportMatch = scriptContent.match(/export{(\w+) as default};/)
if (!exportMatch) {
  throw new Error('Unexpected dist/botGuardScript.js format')
}

const profileDir = await mkdtemp(join(tmpdir(), 'ft-yt-potoken-'))
const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1280, height: 800 },
  // youtube.com's Trusted Types policy blocks the script's `new Function`; the Electron sandbox page has no CSP
  bypassCSP: true,
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled'],
})
// The script fetches the BotGuard interpreter cross-origin; the Electron sandbox adds CORS headers to every response
await context.route('https://www.google.com/js/**', async (route) => {
  const response = await route.fetch()
  await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } })
})

const page = context.pages()[0] ?? await context.newPage()
await page.goto('https://www.youtube.com/')

// Runs one generation at a time, in a fresh page each time like the Electron sandbox
let queue = Promise.resolve()

const server = createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/potoken') {
    response.writeHead(404).end()
    return
  }

  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    queue = queue.then(async () => {
      try {
        const { videoId, context: ytContext, initialAttestationData, ytConfig, cpn } = JSON.parse(body)
        const script = scriptContent.replace(exportMatch[0], `;return ${exportMatch[1]}(${JSON.stringify(videoId)},${ytContext},${initialAttestationData},${ytConfig},${JSON.stringify(cpn ?? null)})`)

        await page.reload()
        const result = await page.evaluate(`(async () => { ${script} })()`)
        console.log(`minted for ${videoId}: poToken ${result.poToken?.length} chars, attestation ${result.attestationResponse ? 'yes' : 'no'}`)
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
      } catch (error) {
        console.error(error)
        response.writeHead(500).end(String(error))
      }
    })
  })
})

server.listen(PORT, '127.0.0.1', () => console.log(`PO token oracle on http://127.0.0.1:${PORT}/potoken`))

const shutdown = async () => {
  server.close()
  await context.close()
  await rm(profileDir, { recursive: true, force: true })
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
