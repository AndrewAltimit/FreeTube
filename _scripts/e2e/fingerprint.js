// Collects the browser environment signals BotGuard is known to look at, as a plain object, so the BotGuard sandbox in
// FreeTube can be compared with a real browser (see youtube-web-baseline.mjs). Runs in a page; keep it dependency-free.
// eslint-disable-next-line no-unused-vars
function collectFingerprint() {
  const safe = (fn) => {
    try {
      return fn()
    } catch (error) {
      return `error: ${error.message}`
    }
  }

  const webgl = safe(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl')
    if (!gl) return null
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    }
  })

  return {
    href: location.href,
    origin: location.origin,
    isSecureContext: window.isSecureContext,
    webdriver: navigator.webdriver,
    userAgent: navigator.userAgent,
    userAgentData: safe(() => navigator.userAgentData && {
      brands: navigator.userAgentData.brands.map(brand => `${brand.brand} ${brand.version}`),
      mobile: navigator.userAgentData.mobile,
      platform: navigator.userAgentData.platform,
    }),
    platform: navigator.platform,
    vendor: navigator.vendor,
    languages: navigator.languages,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    maxTouchPoints: navigator.maxTouchPoints,
    plugins: safe(() => navigator.plugins.length),
    mimeTypes: safe(() => navigator.mimeTypes.length),
    pdfViewerEnabled: navigator.pdfViewerEnabled,
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    windowChrome: typeof window.chrome,
    windowChromeKeys: safe(() => window.chrome ? Object.keys(window.chrome).sort() : null),
    screen: safe(() => ({
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
    })),
    window: { innerWidth, innerHeight, outerWidth, outerHeight, devicePixelRatio, screenX, screenY },
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    hasFocus: safe(() => document.hasFocus()),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    webgl,
    notificationPermission: safe(() => typeof Notification === 'undefined' ? 'no Notification' : Notification.permission),
    historyLength: history.length,
    referrer: document.referrer,
    hasProcess: typeof process !== 'undefined',
    hasRequire: typeof require !== 'undefined',
    electronInUA: /Electron/.test(navigator.userAgent),
  }
}
