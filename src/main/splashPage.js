// The update splash shown at startup while a new version downloads. No Electron imports, so it can be unit tested.

/**
 * @param {{ dark: boolean, logoDataUrl: string | null }} options
 * @returns {string} a self-contained HTML page; the main process drives it through `window.setUpdateStatus`
 */
export function buildSplashPage({ dark, logoDataUrl }) {
  const background = dark ? '#212121' : '#f1f1f1'
  const text = dark ? '#eeeeee' : '#212121'
  const track = dark ? '#3a3a3a' : '#d6d6d6'
  // Only data: URLs are embedded, anything else is dropped rather than escaped into the page
  const logo = typeof logoDataUrl === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(logoDataUrl)
    ? `<img class="logo" src="${logoDataUrl}" alt="">`
    : ''

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; user-select: none; cursor: default }
  body {
    background: ${background}; color: ${text};
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
    -webkit-app-region: drag;
  }
  .logo { width: 88px; height: 88px; animation: pulse 1.6s ease-in-out infinite }
  @keyframes pulse { 50% { transform: scale(0.92); opacity: 0.8 } }
  .status { font-size: 14px; min-height: 1.2em; text-align: center; padding: 0 16px }
  .track { width: 200px; height: 4px; border-radius: 2px; background: ${track}; overflow: hidden }
  .bar { width: 0; height: 100%; background: #f04242; transition: width 0.2s }
  .track.indeterminate .bar { width: 40%; animation: slide 1.2s ease-in-out infinite }
  @keyframes slide { from { transform: translateX(-100%) } to { transform: translateX(250%) } }
</style>
</head>
<body>
${logo}
<div class="status" id="status">Checking for updates…</div>
<div class="track indeterminate" id="track"><div class="bar" id="bar"></div></div>
<script>
  window.setUpdateStatus = function (status, fraction) {
    document.getElementById('status').textContent = status
    var track = document.getElementById('track')
    if (typeof fraction === 'number' && fraction >= 0) {
      track.classList.remove('indeterminate')
      document.getElementById('bar').style.width = Math.round(Math.min(fraction, 1) * 100) + '%'
    } else {
      track.classList.add('indeterminate')
      document.getElementById('bar').style.width = ''
    }
  }
</script>
</body>
</html>`
}
