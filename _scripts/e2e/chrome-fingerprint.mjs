// Prints the fingerprint (see fingerprint.js) of a youtube.com page in the installed Chrome with a fresh profile and
// without the automation markers, for comparison with FreeTube's BotGuard sandbox.
// Usage: node _scripts/e2e/chrome-fingerprint.mjs > chrome.json

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const fingerprintSource = await readFile(new URL('./fingerprint.js', import.meta.url), 'utf-8')
const profileDir = await mkdtemp(join(tmpdir(), 'ft-yt-fingerprint-'))
const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1280, height: 800 },
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled'],
})

try {
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto('https://www.youtube.com/')
  const fingerprint = await page.evaluate(`${fingerprintSource}\ncollectFingerprint()`)
  console.log(JSON.stringify(fingerprint, null, 2))
} finally {
  await context.close()
  await rm(profileDir, { recursive: true, force: true })
}
