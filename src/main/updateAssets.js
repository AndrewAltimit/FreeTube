// Picks and checks the release asset the in-app updater installs. No Electron imports, so it can be unit tested.

export const RELEASE_REPOSITORY = 'AndrewAltimit/FreeTube'
export const RELEASE_DOWNLOAD_PREFIX = `https://github.com/${RELEASE_REPOSITORY}/releases/download/`

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/**
 * @param {string} version
 * @returns {boolean} whether it is a plain semantic version, safe to put in a URL and a file name
 */
export function isValidUpdateVersion(version) {
  return typeof version === 'string' && VERSION_PATTERN.test(version)
}

/**
 * @param {string} version without the `v`
 * @returns {string} the GitHub API URL of that version's release
 */
export function getReleaseApiUrl(version) {
  return `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/tags/v${version}`
}

/**
 * How this copy of FreeTube was installed, which decides the asset to download and how to install it.
 * `null` when the in-app updater can't update it (an unpackaged build, Flatpak, a zip, an unknown platform).
 * @typedef {'nsis' | 'dmg' | 'appimage' | 'deb' | 'rpm'} InstallKind
 */

/** @type {Record<InstallKind, (version: string, arch: string) => string>} */
const ASSET_NAMES = {
  nsis: (version, arch) => `freetube-${version}-win-${arch}-setup.exe`,
  dmg: (version, arch) => `freetube-${version}-mac-${arch}.dmg`,
  appimage: (version, arch) => `freetube-${version}-linux-${arch}.AppImage`,
  deb: (version, arch) => `freetube-${version}-linux-${arch}.deb`,
  rpm: (version, arch) => `freetube-${version}-linux-${arch}.rpm`,
}

/**
 * Finds the release asset for this install. Only assets served from this repository's release downloads count,
 * so a release body or API response can't point the updater somewhere else.
 * @param {{ name: string, browser_download_url: string }[]} assets
 * @param {string} version
 * @param {InstallKind} kind
 * @param {string} arch `x64` or `arm64`
 * @returns {{ name: string, url: string } | null}
 */
export function selectUpdateAsset(assets, version, kind, arch) {
  if (!Array.isArray(assets) || !(kind in ASSET_NAMES) || (arch !== 'x64' && arch !== 'arm64')) {
    return null
  }

  const name = ASSET_NAMES[kind](version, arch)
  const asset = assets.find(asset => asset?.name === name)
  const url = asset?.browser_download_url

  if (typeof url !== 'string' || url !== `${RELEASE_DOWNLOAD_PREFIX}v${version}/${name}`) {
    return null
  }

  return { name, url }
}

/**
 * @param {{ name: string, browser_download_url: string }[]} assets
 * @param {string} version
 * @returns {string | null} the URL of the release's SHA256SUMS file
 */
export function selectChecksumsAsset(assets, version) {
  const url = Array.isArray(assets)
    ? assets.find(asset => asset?.name === 'SHA256SUMS')?.browser_download_url
    : undefined

  return url === `${RELEASE_DOWNLOAD_PREFIX}v${version}/SHA256SUMS` ? url : null
}

/**
 * Parses `sha256sum` output (`<hash>  <name>`, or `<hash> *<name>` in binary mode).
 * @param {string} text
 * @returns {Map<string, string>} file name to lowercase hex hash
 */
export function parseSha256Sums(text) {
  /** @type {Map<string, string>} */
  const sums = new Map()

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([0-9a-fA-F]{64}) [ *](.+)$/)
    if (match) {
      sums.set(match[2].trim(), match[1].toLowerCase())
    }
  }

  return sums
}
