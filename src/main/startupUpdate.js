// Installs a new release at startup, before the main window opens, with a splash window showing progress.
// Only for installs that update silently (STARTUP_INSTALL_KINDS); the others keep the update banner. Anything that
// goes wrong (offline, a slow or stalled download, a bad checksum) just starts FreeTube normally.

import { app, BrowserWindow, nativeTheme, net } from 'electron'
import asyncFs from 'fs/promises'
import path from 'path'

import { isNewerVersion, RELEASES_API_URL } from '../renderer/helpers/updates'
import { buildSplashPage } from './splashPage'
import { selectStartupUpdateVersion, STARTUP_INSTALL_KINDS } from './updateAssets'
import { getInstallKind, installUpdate } from './updater'

/** How long startup waits for GitHub to answer before opening FreeTube without updating */
const CHECK_TIMEOUT_MS = 4000
/** The check usually answers before this, so the splash only shows when it doesn't, or once there is an update */
const SPLASH_DELAY_MS = 400
/** A download that makes no progress for this long is given up on */
const DOWNLOAD_STALL_MS = 30000

let inProgress = false

/**
 * @returns {boolean} whether the startup updater is running, so a second instance shouldn't open a window yet
 */
export function isStartupUpdateInProgress() {
  return inProgress
}

/**
 * Starts looking for a release to install. Call it as early as the session's proxy is set, so the request
 * overlaps the rest of startup.
 * @returns {Promise<string | null>} the version to install, or null
 */
export async function findStartupUpdate() {
  try {
    const kind = await getInstallKind()
    if (!STARTUP_INSTALL_KINDS.has(kind)) {
      return null
    }

    const response = await net.fetch(RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
    })
    if (!response.ok) {
      return null
    }

    return selectStartupUpdateVersion(await response.json(), app.getVersion(), isNewerVersion)
  } catch (error) {
    console.error('startup update check failed', error)
    return null
  }
}

/**
 * Waits for `findStartupUpdate` and installs what it found, showing the splash while that takes time.
 * @param {Promise<string | null>} updateCheck
 * @returns {Promise<boolean>} true when FreeTube is quitting to install, so no window should be opened
 */
export async function runStartupUpdate(updateCheck) {
  inProgress = true
  /** @type {BrowserWindow | null} */
  let splash = null
  const splashTimer = setTimeout(() => { splash = createSplash() }, SPLASH_DELAY_MS)

  try {
    const version = await updateCheck
    clearTimeout(splashTimer)
    if (version === null) {
      return false
    }

    splash ??= createSplash()
    const setStatus = (status, fraction = -1) => {
      if (!splash.isDestroyed()) {
        splash.webContents.executeJavaScript(`window.setUpdateStatus?.(${JSON.stringify(status)}, ${Number(fraction)})`)
          .catch(() => {})
      }
    }
    setStatus(`Downloading FreeTube ${version}…`, 0)

    const abortController = new AbortController()
    let stallTimer = setTimeout(() => abortController.abort(), DOWNLOAD_STALL_MS)

    try {
      const { status } = await installUpdate(version, (fraction) => {
        clearTimeout(stallTimer)
        stallTimer = setTimeout(() => abortController.abort(), DOWNLOAD_STALL_MS)
        setStatus(`Downloading FreeTube ${version}… ${Math.floor(fraction * 100)}%`, fraction)
      }, abortController.signal)

      if (status === 'installing') {
        setStatus(`Installing FreeTube ${version}…`)
        return true
      }
      return false
    } finally {
      clearTimeout(stallTimer)
    }
  } catch (error) {
    console.error('startup update failed, starting normally', error)
    return false
  } finally {
    clearTimeout(splashTimer)
    inProgress = false
  }
}

/**
 * Closes the splash once the main window exists, so closing it never leaves FreeTube without a window.
 */
export function closeStartupSplash() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (splashWindows.has(window) && !window.isDestroyed()) {
      window.destroy()
    }
  }
  splashWindows.clear()
}

/** @type {Set<BrowserWindow>} */
const splashWindows = new Set()

/**
 * @returns {BrowserWindow}
 */
function createSplash() {
  const dark = nativeTheme.shouldUseDarkColors
  const splash = new BrowserWindow({
    width: 300,
    height: 340,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    // It closes itself; closing it early would quit FreeTube before the main window exists
    closable: false,
    center: true,
    show: false,
    backgroundColor: dark ? '#212121' : '#f1f1f1',
    icon: getIconPath(),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    }
  })
  splashWindows.add(splash)
  splash.removeMenu()
  splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  splash.webContents.on('will-navigate', (event) => event.preventDefault())
  splash.once('ready-to-show', () => splash.show())
  // Not closable by the person, so make sure quitting (to install, or from the tray) isn't held up by it
  app.once('before-quit', () => {
    if (!splash.isDestroyed()) {
      splash.destroy()
    }
  })

  loadSplash(splash, dark)
  return splash
}

/**
 * @param {BrowserWindow} splash
 * @param {boolean} dark
 */
async function loadSplash(splash, dark) {
  let logoDataUrl = null
  try {
    logoDataUrl = `data:image/png;base64,${(await asyncFs.readFile(getIconPath())).toString('base64')}`
  } catch {}

  if (!splash.isDestroyed()) {
    const html = buildSplashPage({ dark, logoDataUrl })
    splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {})
  }
}

function getIconPath() {
  return process.env.NODE_ENV === 'development'
    ? path.join(__dirname, '../../_icons/iconColor.png')
    : path.join(__dirname, '../_icons/iconColor.png')
}
