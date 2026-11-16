import { describe, expect, it } from 'vitest'

import {
  compareVersions,
  isNewerVersion,
  parseVersion,
  RELEASES_API_URL,
  RELEASES_PAGE_URL,
} from '../../../../src/renderer/helpers/updates.js'

describe('parseVersion', () => {
  it('parses versions with or without the tag prefix', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
  })

  it('splits pre-release identifiers and ignores build metadata', () => {
    expect(parseVersion('v1.0.0-fork.1').prerelease).toEqual(['fork', '1'])
    expect(parseVersion('1.0.0+build.7').prerelease).toEqual([])
  })

  it('returns null for anything that is not a version', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('1.0')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion(undefined)).toBeNull()
  })
})

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '0.26.0'],
    ['1.0.0', '0.99.99'],
    ['1.1.0', '1.0.9'],
    ['1.0.10', '1.0.9'],
    ['2.0.0', '1.99.0'],
    ['1.0.0', '1.0.0-fork.1'],
    ['1.0.0-fork.2', '1.0.0-fork.1'],
    ['1.0.0-fork.10', '1.0.0-fork.9'],
    ['1.0.0-beta', '1.0.0-alpha'],
    ['1.0.0-alpha.1', '1.0.0-alpha'],
    ['1.0.0-alpha', '1.0.0-1'],
  ])('%s is newer than %s', (newer, older) => {
    expect(compareVersions(newer, older)).toBeGreaterThan(0)
    expect(compareVersions(older, newer)).toBeLessThan(0)
  })

  it('treats equal versions as equal, ignoring the tag prefix', () => {
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0-fork.1', 'v1.0.0-fork.1')).toBe(0)
  })

  it('returns NaN when either side is not a version', () => {
    expect(compareVersions('1.0.0', 'nightly')).toBeNaN()
  })
})

describe('isNewerVersion', () => {
  it('does not offer an older major version with a higher minor one', () => {
    // The old check compared each part on its own, so 1.0.0 saw 0.26.0 as an update
    expect(isNewerVersion('1.0.0', 'v0.26.0')).toBe(false)
    expect(isNewerVersion('1.0.0', 'v0.27.0-beta')).toBe(false)
  })

  it('offers newer releases, including the release of a pre-release', () => {
    expect(isNewerVersion('1.0.0', 'v1.0.1')).toBe(true)
    expect(isNewerVersion('1.0.0', 'v1.1.0')).toBe(true)
    expect(isNewerVersion('1.0.0-fork.1', 'v1.0.0')).toBe(true)
  })

  it('does not offer the same version or an unparseable tag', () => {
    expect(isNewerVersion('1.0.0', 'v1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', 'nightly')).toBe(false)
  })
})

describe('release URLs', () => {
  it("point at this fork's releases, not upstream's", () => {
    expect(RELEASES_API_URL).toBe('https://api.github.com/repos/AndrewAltimit/FreeTube/releases?per_page=1')
    expect(RELEASES_PAGE_URL).toBe('https://github.com/AndrewAltimit/FreeTube/releases')
  })
})
