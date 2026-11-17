// One-click updates: downloads this platform's build of a release, checks it against the release's SHA256SUMS
// and installs it. The renderer only passes a version; the asset URLs come from GitHub's API for that release
// and must point at this repository's release downloads (see updateAssets.js).

import { app, net, shell } from 'electron'
import cp from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import asyncFs from 'fs/promises'
import path from 'path'
import { promisify } from 'util'

import {
  getReleaseApiUrl,
  isValidUpdateVersion,
  parseSha256Sums,
  selectChecksumsAsset,
  selectUpdateAsset,
} from './updateAssets'

const execFile = promisify(cp.execFile)

/** @type {Promise<import('./updateAssets').InstallKind | null> | undefined} */
let installKindPromise
let installInProgress = false

/**
 * @returns {Promise<import('./updateAssets').InstallKind | null>}
 */
export function getInstallKind() {
  installKindPromise ??= detectInstallKind()
  return installKindPromise
}

/**
 * @returns {Promise<import('./updateAssets').InstallKind | null>}
 */
async function detectInstallKind() {
  if (!app.isPackaged) {
    return null
  }

  switch (process.platform) {
    case 'win32':
      // The fork only ships the NSIS installer for Windows
      return 'nsis'
    case 'darwin':
      return 'dmg'
    case 'linux': {
      if (process.env.APPIMAGE) {
        return 'appimage'
      }

      if (process.env.FLATPAK_ID || process.env.SNAP) {
        return null
      }

      // Ask the package managers which one owns the running executable
      if (await succeeds('dpkg', ['-S', process.execPath])) {
        return 'deb'
      }
      if (await succeeds('rpm', ['-qf', process.execPath])) {
        return 'rpm'
      }
      return null
    }
    default:
      return null
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 */
async function succeeds(command, args) {
  try {
    await execFile(command, args)
    return true
  } catch {
    return false
  }
}

/**
 * The build to download: an x64 build running under ARM64 translation (Rosetta, Windows on ARM) gets the native one.
 * @returns {string}
 */
function getTargetArch() {
  return app.runningUnderARM64Translation ? 'arm64' : process.arch
}

/**
 * @param {string} version
 * @param {(fraction: number) => void} onProgress
 * @returns {Promise<{ status: 'installing' | 'opened' | 'unsupported' | 'busy' }>}
 * `installing` means the app is about to quit and the new version start
 */
export async function installUpdate(version, onProgress) {
  if (!isValidUpdateVersion(version)) {
    throw new Error(`Not a version: ${version}`)
  }

  const kind = await getInstallKind()
  if (kind === null) {
    return { status: 'unsupported' }
  }

  if (installInProgress) {
    return { status: 'busy' }
  }

  installInProgress = true
  try {
    const releaseResponse = await net.fetch(getReleaseApiUrl(version), {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!releaseResponse.ok) {
      throw new Error(`Release lookup failed: HTTP ${releaseResponse.status}`)
    }

    const release = await releaseResponse.json()
    const asset = selectUpdateAsset(release.assets, version, kind, getTargetArch())
    const checksumsUrl = selectChecksumsAsset(release.assets, version)
    if (asset === null || checksumsUrl === null) {
      return { status: 'unsupported' }
    }

    const checksumsResponse = await net.fetch(checksumsUrl)
    if (!checksumsResponse.ok) {
      throw new Error(`Checksum download failed: HTTP ${checksumsResponse.status}`)
    }
    const expectedHash = parseSha256Sums(await checksumsResponse.text()).get(asset.name)
    if (expectedHash === undefined) {
      throw new Error(`${asset.name} is missing from SHA256SUMS`)
    }

    const downloadDirectory = path.join(app.getPath('temp'), 'freetube-update')
    await asyncFs.rm(downloadDirectory, { recursive: true, force: true })
    await asyncFs.mkdir(downloadDirectory, { recursive: true })
    const filePath = path.join(downloadDirectory, asset.name)

    const actualHash = await download(asset.url, filePath, onProgress)
    if (actualHash !== expectedHash) {
      await asyncFs.rm(filePath, { force: true })
      throw new Error(`${asset.name} does not match its SHA256SUMS entry`)
    }

    return await install(kind, filePath)
  } finally {
    installInProgress = false
  }
}

/**
 * Streams a file to disk, hashing it on the way.
 * @param {string} url
 * @param {string} filePath
 * @param {(fraction: number) => void} onProgress
 * @returns {Promise<string>} the SHA-256 of the file as lowercase hex
 */
async function download(url, filePath, onProgress) {
  const response = await net.fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status}`)
  }

  const total = Number(response.headers.get('content-length')) || 0
  const hash = createHash('sha256')
  const file = createWriteStream(filePath)
  let received = 0
  let lastReported = 0

  try {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      hash.update(value)
      if (!file.write(value)) {
        await new Promise(resolve => file.once('drain', resolve))
      }

      received += value.byteLength
      if (total > 0 && received - lastReported >= total / 100) {
        lastReported = received
        onProgress(received / total)
      }
    }
  } finally {
    await new Promise((resolve, reject) => file.end(error => error ? reject(error) : resolve()))
  }

  return hash.digest('hex')
}

/**
 * @param {import('./updateAssets').InstallKind} kind
 * @param {string} filePath
 * @returns {Promise<{ status: 'installing' | 'opened' }>}
 */
async function install(kind, filePath) {
  switch (kind) {
    case 'nsis': {
      // The same flags electron-updater uses: silent install over the existing one, then start the new version.
      // A per-machine install still shows the UAC prompt.
      const installer = cp.spawn(filePath, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' })
      installer.unref()
      // The installer closes a running FreeTube itself, quitting first just makes that quicker
      setTimeout(() => app.quit(), 500)
      return { status: 'installing' }
    }
    case 'dmg': {
      // The builds are only ad-hoc signed, so leave replacing the app bundle to the person: open the disk image
      const error = await shell.openPath(filePath)
      if (error) {
        throw new Error(error)
      }
      return { status: 'opened' }
    }
    case 'appimage': {
      const appImagePath = process.env.APPIMAGE
      // Copy next to the running AppImage first, so the swap is a rename on the same file system
      const stagedPath = path.join(path.dirname(appImagePath), `.${path.basename(appImagePath)}.update`)
      await asyncFs.copyFile(filePath, stagedPath)
      await asyncFs.chmod(stagedPath, 0o755)
      await asyncFs.rename(stagedPath, appImagePath)
      await asyncFs.rm(filePath, { force: true })
      relaunch(appImagePath)
      return { status: 'installing' }
    }
    case 'deb':
    case 'rpm': {
      // pkexec shows the desktop's password prompt; installing over the running files is fine, the old ones stay
      // mapped until the app quits
      const args = kind === 'deb' ? ['dpkg', '-i', filePath] : ['rpm', '-U', '--replacepkgs', filePath]
      await execFile('pkexec', args)
      await asyncFs.rm(filePath, { force: true })
      relaunch()
      return { status: 'installing' }
    }
  }
}

/**
 * @param {string} [execPath]
 */
function relaunch(execPath) {
  app.relaunch(execPath ? { execPath, args: process.argv.slice(1) } : undefined)
  setTimeout(() => app.quit(), 500)
}
