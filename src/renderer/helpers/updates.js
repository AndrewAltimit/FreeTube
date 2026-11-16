// The update check looks at this fork's releases, not upstream FreeTube's: the fork has its own version numbers,
// so comparing against upstream would offer "updates" to a different app.
export const RELEASES_API_URL = 'https://api.github.com/repos/AndrewAltimit/FreeTube/releases?per_page=1'
export const REPOSITORY_URL = 'https://github.com/AndrewAltimit/FreeTube'
export const RELEASES_PAGE_URL = `${REPOSITORY_URL}/releases`

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Parses a semantic version, with or without the `v` of a release tag (`v1.0.0`, `v1.2.0-fork.1`).
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number, prerelease: string[] } | null} null if it isn't one
 */
export function parseVersion(version) {
  const match = VERSION_PATTERN.exec(String(version).trim())
  if (!match) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

/**
 * Compares two versions by semantic versioning precedence: a pre-release is older than its release
 * (`1.0.0-fork.1` < `1.0.0`), and pre-release identifiers compare numerically when both are numbers.
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a is older than b, positive if newer, 0 if equal; NaN if either isn't a version
 */
export function compareVersions(a, b) {
  const versionA = parseVersion(a)
  const versionB = parseVersion(b)
  if (!versionA || !versionB) {
    return NaN
  }

  for (const part of ['major', 'minor', 'patch']) {
    if (versionA[part] !== versionB[part]) {
      return versionA[part] - versionB[part]
    }
  }

  const preA = versionA.prerelease
  const preB = versionB.prerelease
  if (preA.length === 0 || preB.length === 0) {
    // The one without a pre-release is newer
    return preB.length - preA.length
  }

  for (let i = 0; i < Math.min(preA.length, preB.length); i++) {
    const numericA = /^\d+$/.test(preA[i])
    const numericB = /^\d+$/.test(preB[i])

    if (numericA && numericB) {
      const difference = Number(preA[i]) - Number(preB[i])
      if (difference !== 0) return difference
    } else if (numericA !== numericB) {
      // Numeric identifiers sort before alphanumeric ones
      return numericA ? -1 : 1
    } else if (preA[i] !== preB[i]) {
      return preA[i] < preB[i] ? -1 : 1
    }
  }

  return preA.length - preB.length
}

/**
 * @param {string} currentVersion - this build's version
 * @param {string} releaseVersion - a release's version or tag
 * @returns {boolean} whether the release is newer; false when either can't be parsed
 */
export function isNewerVersion(currentVersion, releaseVersion) {
  return compareVersions(releaseVersion, currentVersion) > 0
}
