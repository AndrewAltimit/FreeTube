import { session, WebContentsView } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

// #region queue

/**
 * This is the internal Promise object which resolves when all the tasks of the queue are done.
 * It will change any time {@linkcode enqueueAsyncFunction} is called.
 */
let queueGuardian = Promise.resolve()

/**
 * Enqueues an asynchronous function to be executed after the previous ones in the queue have finished.
 * That way the promises/asynchronous functions are executed sequentially rather than in parallel.
 *
 * @template T
 * @param {T} func
 * @param {Parameters<T>} args
 * @returns {ReturnType<T>}
 */
function enqueueAsyncFunction(func, ...args) {
  queueGuardian = queueGuardian.then(() => {
    return func(...args)
      .then(result => ({ error: false, result }), result => ({ error: true, result }))
  })

  return queueGuardian.then(({ error, result }) => {
    if (error) return Promise.reject(result)
    else return Promise.resolve(result)
  })
}

// #endregion queue

let firstTime = true

// #region visitor cookies

// The visitor YouTube's latest watch page response was for. YouTube ties the integrity token (GenerateIT) and the
// playback attestation to the visitor in these cookies; without them both belong to nobody and the SABR session stays
// "attestation pending". Kept in memory only and only sent to YouTube's attestation endpoints, never stored.
const VISITOR_COOKIE_NAMES = ['VISITOR_INFO1_LIVE', 'VISITOR_PRIVACY_METADATA', 'YSC', '__Secure-YNID', '__Secure-ROLLOUT_TOKEN', 'GPS']

/** @type {{ name: string, value: string }[]} */
let visitorCookies = []

/**
 * @param {string[]} setCookieHeaders - the Set-Cookie headers of a YouTube watch page response
 */
export function setYouTubeVisitorCookies(setCookieHeaders) {
  const cookies = setCookieHeaders
    .map(header => header.split(';')[0].trim())
    .map((pair) => {
      const separator = pair.indexOf('=')
      return { name: pair.slice(0, separator), value: pair.slice(separator + 1) }
    })
    .filter(({ name, value }) => VISITOR_COOKIE_NAMES.includes(name) && value)

  if (cookies.length > 0) {
    visitorCookies = cookies
  }
}

/** @returns {string} the visitor cookies as a Cookie header value */
export function getYouTubeVisitorCookieHeader() {
  return visitorCookies.map(({ name, value }) => `${name}=${value}`).join('; ')
}

// #endregion visitor cookies

/**
 * Generates a content-bound poToken (proof of origin token) using `bgutils-js`.
 * The script to generate it is `src/botGuardScript.js`
 *
 * This is intentionally split out into it's own thing, with it's own in-memory session,
 * as the BotGuard stuff accesses the global `document` and `window` objects and also requires making some requests.
 * So we definitely don't want it running in the same places as the rest of the FreeTube code with the user data.
 * @param {string} videoId
 * @param {string} context
 * @param {string} initialAttestationData
 * @param {string} ytConfig
 * @param {string|undefined} cpn
 * @param {string|undefined} proxyUrl
 * @returns {Promise<{ poToken: string, attestationResponse: string | undefined }>}
 */
export function generatePoToken(videoId, context, initialAttestationData, ytConfig, cpn, proxyUrl) {
  if (process.env.NODE_ENV === 'development' && process.env.FREETUBE_POTOKEN_SERVER) {
    // Development-only: get the tokens from _scripts/e2e/chrome-potoken-server.mjs, which runs the same script in Chrome
    return fetch(`${process.env.FREETUBE_POTOKEN_SERVER}/potoken`, {
      method: 'POST',
      body: JSON.stringify({ videoId, context, initialAttestationData, ytConfig, cpn }),
    }).then((response) => {
      if (!response.ok) throw new Error(`PO token server failed with HTTP ${response.status}`)
      return response.json()
    })
  }

  if (firstTime) {
    firstTime = false
    enqueueAsyncFunction(sharedInit)
  }

  // We use a promise queue instead of running the `internalGeneratePotoken` function directly
  // so that we can reuse the same session by clearing all data
  // associated with the session before triggering generating the next PO token.

  // Electron's session objects stick around for the entire lifetime of the Electron main process,
  // holding onto OS resources such as the OS DNS resolver, so if we created a new session for each PO token generation
  // the OS will eventually complain about the resources being exhausted (e.g. too many inotify instances on Linux)

  // References
  // - https://github.com/FreeTubeApp/FreeTube/issues/8640
  // - https://github.com/electron/electron/pull/46131
  // - https://github.com/electron/electron/commit/bac2f46ba981cc1763c0485cec44813c1d07fa18
  const potokenPromise = enqueueAsyncFunction(internalGeneratePotoken, videoId, context, initialAttestationData, ytConfig, cpn, proxyUrl)

  // schedule the cleanup separately,
  // so that we can return the potoken without having to wait until the cleanup is done
  enqueueAsyncFunction(cleanupSession)

  return potokenPromise
}

/** @type {import('electron').Session} */
let theSession
/** @type {string} */
let cachedScript

async function sharedInit() {
  // setup session

  theSession = session.fromPartition('potoken', { cache: false })

  theSession.setPermissionCheckHandler(() => false)
  // eslint-disable-next-line n/no-callback-literal
  theSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false))

  theSession.setUserAgent(session.defaultSession.getUserAgent())

  theSession.webRequest.onBeforeSendHeaders({
    urls: ['https://www.google.com/js/*', 'https://www.youtube.com/youtubei/*']
  }, ({ requestHeaders, url }, callback) => {
    if (url.startsWith('https://www.youtube.com/youtubei/')) {
      // make InnerTube requests work with the fetch function
      // InnerTube rejects requests if the referer isn't YouTube or empty
      requestHeaders.Referer = 'https://www.youtube.com/'
      requestHeaders.Origin = 'https://www.youtube.com'

      requestHeaders['Sec-Fetch-Site'] = 'same-origin'
      requestHeaders['Sec-Fetch-Mode'] = 'same-origin'
      requestHeaders['X-Youtube-Bootstrap-Logged-In'] = 'false'
    } else {
      requestHeaders['Sec-Fetch-Dest'] = 'script'
      requestHeaders['Sec-Fetch-Site'] = 'cross-site'
      requestHeaders['Accept-Language'] = '*'
    }

    // eslint-disable-next-line n/no-callback-literal
    callback({ requestHeaders })
  })

  theSession.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, ({ responseHeaders }, callback) => {
    if (responseHeaders) {
      // eslint-disable-next-line n/no-callback-literal
      callback({
        responseHeaders: {
          ...responseHeaders,
          'Access-Control-Allow-Origin': ['*'],
          'Access-Control-Allow-Methods': ['GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH']
        }
      })
    }
  })

  theSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'], types: ['cspReport', 'ping'] }, (details, callback) => {
    // eslint-disable-next-line n/no-callback-literal
    callback({ cancel: true })
  })

  // load script file

  const pathToScript = process.env.NODE_ENV === 'development'
    ? join(__dirname, '../../dist/botGuardScript.js')
    : join(__dirname, 'botGuardScript.js')

  const scriptContent = await readFile(pathToScript, 'utf-8')

  const scriptExportMatch = scriptContent.match(/export{(\w+) as default};/)

  cachedScript = scriptContent.replace(scriptExportMatch[0], `;${scriptExportMatch[1]}(FT_PARAMS)`)
}

/**
 * @param {string} videoId
 * @param {string} context
 * @param {string} initialAttestationData
 * @param {string} ytConfig
 * @param {string|undefined} cpn
 * @param {string|undefined} proxyUrl
 * @returns {Promise<{ poToken: string, attestationResponse: string | undefined }>}
 */
async function internalGeneratePotoken(videoId, context, initialAttestationData, ytConfig, cpn, proxyUrl) {
  let webContentsView

  try {
    if (proxyUrl) {
      await theSession.setProxy({
        proxyRules: proxyUrl
      })
    }

    for (const { name, value } of visitorCookies) {
      await theSession.cookies.set({ url: 'https://www.youtube.com', name, value, secure: true, sameSite: 'no_restriction' })
    }

    webContentsView = new WebContentsView({
      webPreferences: {
        backgroundThrottling: false,
        safeDialogs: true,
        sandbox: true,
        contextIsolation: true,
        v8CacheOptions: 'none',
        session: theSession,
        offscreen: true,
        disableBlinkFeatures: 'ElectronCSSCornerSmoothing'
      }
    })

    webContentsView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    webContentsView.webContents.setAudioMuted(true)
    // A browser window is taller than its page (tabs, address bar) and shorter than the screen (taskbar)
    webContentsView.setBounds({
      x: 0,
      y: 0,
      width: 1920,
      height: 1032
    })

    webContentsView.webContents.debugger.attach()

    await webContentsView.webContents.loadURL('data:text/html,<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>', {
      baseURLForDataURL: 'https://www.youtube.com/'
    })

    await webContentsView.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 945,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1920,
      screenHeight: 1080,
      positionX: 0,
      positionY: 0,
      screenOrientation: {
        type: 'landscapePrimary',
        angle: 0
      }
    })

    // Present the same identity as Google Chrome of this Chromium version: a reduced user agent string and client
    // hints that include the Google Chrome brand. Electron's own (full version number, Chromium-only brands) is a
    // combination no real browser sends, and BotGuard leaves sessions with it "attestation pending".
    // Sent after the page has loaded, as the command only gets an answer once the view has a renderer process.
    await webContentsView.webContents.debugger.sendCommand('Emulation.setUserAgentOverride', getChromeUserAgentOverride())

    // Google Chrome exposes window.chrome.app, .csi and .loadTimes to every page; Electron leaves window.chrome empty
    await webContentsView.webContents.executeJavaScript(CHROME_OBJECT_SHIM)

    if (process.env.NODE_ENV === 'development' && process.env.FREETUBE_BG_FINGERPRINT) {
      // Development-only: log what BotGuard can see in this sandbox, to compare with a real browser
      // (_scripts/e2e/chrome-fingerprint.mjs). The dev runner starts Electron from the repository root.
      const fingerprintSource = await readFile(join(process.cwd(), '_scripts/e2e/fingerprint.js'), 'utf-8')
      const fingerprint = await webContentsView.webContents.executeJavaScript(`${fingerprintSource}\ncollectFingerprint()`)
      await writeFile(join(tmpdir(), 'freetube-bg-fingerprint.json'), JSON.stringify(fingerprint, null, 2))
    }

    const script = cachedScript.replace('FT_PARAMS', `"${videoId}",${context},${initialAttestationData},${ytConfig},${JSON.stringify(cpn ?? null)}`)

    return await webContentsView.webContents.executeJavaScript(script)
  } finally {
    if (webContentsView) {
      webContentsView.webContents.close({ waitForBeforeUnload: false })
    }
  }
}

const CHROME_OBJECT_SHIM = `(() => {
  const chrome = window.chrome || (window.chrome = {})
  const start = performance.timeOrigin / 1000
  chrome.app = {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    getDetails() { return null },
    getIsInstalled() { return false },
    installState(callback) { callback?.('not_installed') },
    runningState() { return 'cannot_run' },
  }
  chrome.csi = function csi() {
    return { startE: Math.round(performance.timeOrigin), onloadT: Math.round(performance.timeOrigin + performance.now()), pageT: performance.now(), tran: 15 }
  }
  chrome.loadTimes = function loadTimes() {
    return {
      requestTime: start, startLoadTime: start, commitLoadTime: start, finishDocumentLoadTime: start, finishLoadTime: start,
      firstPaintTime: start, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: true,
      wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2',
    }
  }
})()`

/**
 * The user agent and client hints of Google Chrome with the same major version as Electron's Chromium.
 * @returns {object} parameters for the `Emulation.setUserAgentOverride` DevTools Protocol command
 */
export function getChromeUserAgentOverride() {
  // Development-only: match another Chrome version, e.g. the one in _scripts/e2e/chrome-potoken-server.mjs
  const fullVersion = (process.env.NODE_ENV === 'development' && process.env.FREETUBE_CHROME_VERSION) || process.versions.chrome
  const majorVersion = fullVersion.split('.')[0]

  let platform, platformVersion, userAgentPlatform, navigatorPlatform
  switch (process.platform) {
    case 'win32':
      platform = 'Windows'
      platformVersion = '19.0.0'
      userAgentPlatform = 'Windows NT 10.0; Win64; x64'
      navigatorPlatform = 'Win32'
      break
    case 'darwin':
      platform = 'macOS'
      platformVersion = '15.0.0'
      userAgentPlatform = 'Macintosh; Intel Mac OS X 10_15_7'
      navigatorPlatform = 'MacIntel'
      break
    default:
      platform = 'Linux'
      platformVersion = ''
      userAgentPlatform = 'X11; Linux x86_64'
      navigatorPlatform = 'Linux x86_64'
  }

  const brands = [
    { brand: 'Google Chrome', version: majorVersion },
    { brand: 'Chromium', version: majorVersion },
    { brand: 'Not?A_Brand', version: '24' },
  ]

  return {
    userAgent: `Mozilla/5.0 (${userAgentPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion}.0.0.0 Safari/537.36`,
    acceptLanguage: 'en-US,en',
    platform: navigatorPlatform,
    userAgentMetadata: {
      brands,
      fullVersionList: brands.map(({ brand }) => ({ brand, version: brand === 'Not?A_Brand' ? '24.0.0.0' : fullVersion })),
      fullVersion,
      platform,
      platformVersion,
      architecture: process.arch === 'arm64' ? 'arm' : 'x86',
      model: '',
      mobile: false,
      bitness: '64',
      wow64: false,
    },
  }
}

/**
 * The request headers Google Chrome sends with that identity, see {@linkcode getChromeUserAgentOverride}.
 * @returns {Record<string, string>}
 */
export function getChromeIdentityHeaders() {
  const { userAgent, userAgentMetadata } = getChromeUserAgentOverride()

  return {
    'User-Agent': userAgent,
    'sec-ch-ua': userAgentMetadata.brands.map(({ brand, version }) => `"${brand}";v="${version}"`).join(', '),
    'sec-ch-ua-mobile': userAgentMetadata.mobile ? '?1' : '?0',
    'sec-ch-ua-platform': `"${userAgentMetadata.platform}"`,
  }
}

async function cleanupSession() {
  await theSession.closeAllConnections()
  await theSession.clearData()
}
