// Development helper: reloads the current route in the running dev app (`pnpm run debug`) and prints console errors
// and any error text on the page, for diagnosing a watch page that doesn't load.
import { chromium } from 'playwright-core'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const page = browser.contexts().flatMap(context => context.pages()).find(p => p.url().startsWith('http://localhost:9080'))

page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    console.log(`[${message.type()}] ${message.text().split('\n').slice(0, 4).join(' | ')}`)
  }
})

console.log('route:', page.url())
await page.reload()
await new Promise(resolve => setTimeout(resolve, 20_000))

const errorText = await page.evaluate(() => {
  const nodes = document.querySelectorAll('.message, .errorMessage, .error, [class*="error"]')
  return [...nodes].map(node => node.textContent.trim()).filter(Boolean).slice(0, 5)
})
console.log('error text on page:', errorText)
await browser.close()
