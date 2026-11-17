import { describe, expect, it } from 'vitest'

import {
  getReleaseApiUrl,
  isValidUpdateVersion,
  parseSha256Sums,
  selectChecksumsAsset,
  selectStartupUpdateVersion,
  selectUpdateAsset,
  STARTUP_INSTALL_KINDS,
} from '../../../src/main/updateAssets.js'
import { isNewerVersion } from '../../../src/renderer/helpers/updates.js'
import { buildSplashPage } from '../../../src/main/splashPage.js'

const download = (name, version = '1.2.0') => ({
  name,
  browser_download_url: `https://github.com/AndrewAltimit/FreeTube/releases/download/v${version}/${name}`,
})

const assets = [
  'freetube-1.2.0-linux-arm64.AppImage',
  'freetube-1.2.0-linux-x64.AppImage',
  'freetube-1.2.0-linux-x64.deb',
  'freetube-1.2.0-linux-x64.rpm',
  'freetube-1.2.0-mac-arm64.dmg',
  'freetube-1.2.0-mac-x64.dmg',
  'freetube-1.2.0-win-arm64-setup.exe',
  'freetube-1.2.0-win-x64-setup.exe',
  'SHA256SUMS',
].map(name => download(name))

describe('isValidUpdateVersion', () => {
  it('accepts plain and pre-release versions only', () => {
    expect(isValidUpdateVersion('1.2.0')).toBe(true)
    expect(isValidUpdateVersion('1.2.0-fork.1')).toBe(true)
    expect(isValidUpdateVersion('v1.2.0')).toBe(false)
    expect(isValidUpdateVersion('1.2.0/../../x')).toBe(false)
    expect(isValidUpdateVersion(undefined)).toBe(false)
  })
})

describe('getReleaseApiUrl', () => {
  it('looks the release up by its tag', () => {
    expect(getReleaseApiUrl('1.2.0')).toBe('https://api.github.com/repos/AndrewAltimit/FreeTube/releases/tags/v1.2.0')
  })
})

describe('selectUpdateAsset', () => {
  it('picks the asset for each install kind and architecture', () => {
    expect(selectUpdateAsset(assets, '1.2.0', 'nsis', 'x64').name).toBe('freetube-1.2.0-win-x64-setup.exe')
    expect(selectUpdateAsset(assets, '1.2.0', 'nsis', 'arm64').name).toBe('freetube-1.2.0-win-arm64-setup.exe')
    expect(selectUpdateAsset(assets, '1.2.0', 'dmg', 'arm64').name).toBe('freetube-1.2.0-mac-arm64.dmg')
    expect(selectUpdateAsset(assets, '1.2.0', 'appimage', 'arm64').name).toBe('freetube-1.2.0-linux-arm64.AppImage')
    expect(selectUpdateAsset(assets, '1.2.0', 'deb', 'x64').name).toBe('freetube-1.2.0-linux-x64.deb')
    expect(selectUpdateAsset(assets, '1.2.0', 'rpm', 'x64')).toEqual({
      name: 'freetube-1.2.0-linux-x64.rpm',
      url: 'https://github.com/AndrewAltimit/FreeTube/releases/download/v1.2.0/freetube-1.2.0-linux-x64.rpm',
    })
  })

  it('returns null when the release has no build for this install', () => {
    expect(selectUpdateAsset(assets, '1.2.0', 'deb', 'arm64')).toBeNull()
    expect(selectUpdateAsset(assets, '1.2.0', 'nsis', 'ia32')).toBeNull()
    expect(selectUpdateAsset(assets, '1.2.0', 'flatpak', 'x64')).toBeNull()
    expect(selectUpdateAsset(undefined, '1.2.0', 'nsis', 'x64')).toBeNull()
  })

  it('rejects download URLs outside this repository or for another version', () => {
    const elsewhere = [{ name: 'freetube-1.2.0-win-x64-setup.exe', browser_download_url: 'https://example.com/freetube-1.2.0-win-x64-setup.exe' }]
    expect(selectUpdateAsset(elsewhere, '1.2.0', 'nsis', 'x64')).toBeNull()

    const otherVersion = [{ ...download('freetube-1.2.0-win-x64-setup.exe', '1.1.0') }]
    expect(selectUpdateAsset(otherVersion, '1.2.0', 'nsis', 'x64')).toBeNull()
  })
})

describe('selectChecksumsAsset', () => {
  it('finds the release SHA256SUMS in this repository only', () => {
    expect(selectChecksumsAsset(assets, '1.2.0')).toBe('https://github.com/AndrewAltimit/FreeTube/releases/download/v1.2.0/SHA256SUMS')
    expect(selectChecksumsAsset([{ name: 'SHA256SUMS', browser_download_url: 'https://example.com/SHA256SUMS' }], '1.2.0')).toBeNull()
    expect(selectChecksumsAsset([], '1.2.0')).toBeNull()
  })
})

describe('parseSha256Sums', () => {
  it('reads text and binary mode lines, ignoring anything else', () => {
    const hashA = 'a'.repeat(64)
    const hashB = 'B'.repeat(64)
    const sums = parseSha256Sums(`${hashA}  freetube-1.2.0-linux-x64.deb\r\n${hashB} *freetube-1.2.0-win-x64-setup.exe\nnot a line\n`)

    expect(sums.get('freetube-1.2.0-linux-x64.deb')).toBe(hashA)
    expect(sums.get('freetube-1.2.0-win-x64-setup.exe')).toBe('b'.repeat(64))
    expect(sums.size).toBe(2)
  })
})

describe('selectStartupUpdateVersion', () => {
  const release = (tag, extra = {}) => [{ tag_name: tag, draft: false, ...extra }]

  it('returns a newer release without the v', () => {
    expect(selectStartupUpdateVersion(release('v1.3.0'), '1.2.0', isNewerVersion)).toBe('1.3.0')
  })

  it('ignores the same or an older release', () => {
    expect(selectStartupUpdateVersion(release('v1.2.0'), '1.2.0', isNewerVersion)).toBeNull()
    expect(selectStartupUpdateVersion(release('v1.1.0'), '1.2.0', isNewerVersion)).toBeNull()
  })

  it('ignores drafts, odd tags and anything that is not a release list', () => {
    expect(selectStartupUpdateVersion(release('v1.3.0', { draft: true }), '1.2.0', isNewerVersion)).toBeNull()
    expect(selectStartupUpdateVersion(release('v1.3.0/../x'), '1.2.0', isNewerVersion)).toBeNull()
    expect(selectStartupUpdateVersion(release(13), '1.2.0', isNewerVersion)).toBeNull()
    expect(selectStartupUpdateVersion([], '1.2.0', isNewerVersion)).toBeNull()
    expect(selectStartupUpdateVersion({ message: 'API rate limit exceeded' }, '1.2.0', isNewerVersion)).toBeNull()
  })
})

describe('STARTUP_INSTALL_KINDS', () => {
  it('only covers installs that update without asking', () => {
    expect([...STARTUP_INSTALL_KINDS].sort()).toEqual(['appimage', 'nsis'])
  })
})

describe('buildSplashPage', () => {
  it('embeds a PNG data URL logo and the status hook', () => {
    const html = buildSplashPage({ dark: true, logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=' })
    expect(html).toContain('<img class="logo" src="data:image/png;base64,iVBORw0KGgo="')
    expect(html).toContain('window.setUpdateStatus')
    expect(html).toContain('#212121')
  })

  it('drops a logo that is not a PNG data URL', () => {
    const html = buildSplashPage({ dark: false, logoDataUrl: 'javascript:alert(1)"><script>' })
    expect(html).not.toContain('<img')
    expect(html).toContain('#f1f1f1')
  })
})
