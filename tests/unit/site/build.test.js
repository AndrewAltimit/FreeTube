import { describe, expect, it } from 'vitest'

import config from '../../../_scripts/ebuilder.config.mjs'
import { groupAssets, pickRelease } from '../../../site/build.mjs'

/** Expands an electron-builder artifactName pattern the way the builder does. */
function expand(pattern, os, arch, ext) {
  const values = { name: 'freetube', version: '0.26.0', os, arch, ext }
  return pattern.replaceAll(/\$\{(\w+)\}/g, (_, macro) => values[macro])
}

const asset = (name, size = 100 * 1024 * 1024) => ({ name, size, browser_download_url: `https://example.invalid/${name}` })

describe('site/build.mjs', () => {
  describe('groupAssets', () => {
    it('recognises every package the release workflow publishes, under the builder config names', () => {
      const names = []
      for (const arch of ['x64', 'arm64']) {
        for (const ext of ['deb', 'rpm', 'pacman', 'AppImage', 'zip', '7z']) {
          names.push(expand(config.artifactName, 'linux', arch, ext))
        }
        names.push(
          expand(config.nsis.artifactName, 'win', arch, 'exe'),
          expand(config.portable.artifactName, 'win', arch, 'exe'),
          expand(config.artifactName, 'win', arch, 'zip'),
          expand(config.artifactName, 'win', arch, '7z'),
        )
        for (const ext of ['dmg', 'zip', '7z']) {
          names.push(expand(config.artifactName, 'mac', arch, ext))
        }
      }

      const groups = groupAssets(names.map((name) => asset(name)))

      for (const arch of ['x64', 'arm64']) {
        expect(groups.linux[arch]).toHaveLength(6)
        expect(groups.win[arch]).toHaveLength(4)
        expect(groups.mac[arch]).toHaveLength(3)
      }
    })

    it('orders each architecture with the recommended package first', () => {
      const groups = groupAssets([
        asset('freetube-0.26.0-win-x64.zip'),
        asset('freetube-0.26.0-win-x64-portable.exe'),
        asset('freetube-0.26.0-win-x64-setup.exe'),
      ])

      expect(groups.win.x64.map((item) => item.label)).toEqual(['Installer (.exe)', 'Portable (.exe)', '.zip'])
      expect(groups.win.x64.map((item) => item.recommended)).toEqual([true, false, false])
    })

    it('ignores checksums and files it does not know', () => {
      const groups = groupAssets([asset('SHA256SUMS'), asset('freetube-0.26.0-linux-x64.AppImage.blockmap')])

      expect(groups).toEqual({})
    })
  })

  describe('pickRelease', () => {
    it('prefers the newest full release over a newer pre-release and skips drafts', () => {
      const release = pickRelease([
        { tag_name: 'v3', draft: true },
        { tag_name: 'v2-rc1', prerelease: true },
        { tag_name: 'v1' },
      ])

      expect(release.tag_name).toBe('v1')
    })

    it('falls back to a pre-release, and to null with nothing published', () => {
      expect(pickRelease([{ tag_name: 'v2-rc1', prerelease: true }]).tag_name).toBe('v2-rc1')
      expect(pickRelease([{ tag_name: 'v3', draft: true }])).toBeNull()
      expect(pickRelease({ message: 'Not Found' })).toBeNull()
    })
  })
})
