// Builds the GitHub Pages site into site/dist/.
//
//   node site/build.mjs [releases.json]
//
// releases.json is the REST response of GET /repos/{owner}/{repo}/releases
// (pages.yml fetches it with `gh api`). The newest published release becomes
// the download table, so the page itself makes no API calls: every link is
// plain HTML pointing at the release's assets. Without the file, or with no
// published release, the page links to the releases list instead.

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const siteDir = dirname(fileURLToPath(import.meta.url))
const rootDir = join(siteDir, '..')
const outDir = join(siteDir, 'dist')

const REPO_URL = 'https://github.com/AndrewAltimit/FreeTube'

const PLATFORMS = [
  { os: 'win', name: 'Windows' },
  { os: 'mac', name: 'macOS' },
  { os: 'linux', name: 'Linux' },
]

const ARCH_LABELS = { x64: 'x64 (Intel / AMD)', arm64: 'ARM64' }

// Matches the artifactName patterns in _scripts/ebuilder.config.mjs.
const ASSET_PATTERN = /-(linux|win|mac)-(x64|arm64)(-setup|-portable)?\.(\w+)$/

/** Display order and label of each package kind; the first is the recommended one. */
const KINDS = {
  win: [
    { key: '-setup.exe', label: 'Installer (.exe)' },
    { key: '-portable.exe', label: 'Portable (.exe)' },
    { key: '.zip', label: '.zip' },
    { key: '.7z', label: '.7z' },
  ],
  mac: [
    { key: '.dmg', label: 'Disk image (.dmg)' },
    { key: '.zip', label: '.zip' },
    { key: '.7z', label: '.7z' },
  ],
  linux: [
    { key: '.AppImage', label: 'AppImage' },
    { key: '.deb', label: 'Debian / Ubuntu (.deb)' },
    { key: '.rpm', label: 'Fedora / openSUSE (.rpm)' },
    { key: '.pacman', label: 'Arch (.pacman)' },
    { key: '.zip', label: '.zip' },
    { key: '.7z', label: '.7z' },
  ],
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function formatSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

/** Newest published full release, else the newest published pre-release. */
export function pickRelease(releases) {
  if (!Array.isArray(releases)) {
    return null
  }

  const published = releases.filter((release) => !release.draft)
  return published.find((release) => !release.prerelease) ?? published[0] ?? null
}

/** Groups a release's assets as { os: { arch: [{ label, url, size, recommended }] } }. */
export function groupAssets(assets) {
  const groups = {}

  for (const asset of assets ?? []) {
    const match = ASSET_PATTERN.exec(asset.name)
    if (!match) {
      continue
    }

    const [, os, arch, variant = '', ext] = match
    const key = `${variant}.${ext}`
    const kinds = KINDS[os]
    const index = kinds.findIndex((kind) => kind.key === key)
    if (index === -1) {
      continue
    }

    groups[os] ??= {}
    groups[os][arch] ??= []
    groups[os][arch].push({
      order: index,
      label: kinds[index].label,
      url: asset.browser_download_url,
      size: asset.size,
      recommended: index === 0,
    })
  }

  for (const archs of Object.values(groups)) {
    for (const list of Object.values(archs)) {
      list.sort((a, b) => a.order - b.order)
    }
  }

  return groups
}

function renderDownloads(release) {
  if (!release) {
    return `<p class="empty">No release has been published yet. Builds will appear on the
      <a href="${REPO_URL}/releases">releases page</a>.</p>`
  }

  const groups = groupAssets(release.assets)
  const cards = PLATFORMS.map(({ os, name }) => {
    const archs = groups[os] ?? {}
    const rows = ['x64', 'arm64']
      .filter((arch) => archs[arch]?.length)
      .map((arch) => {
        const links = archs[arch].map((item) =>
          `<a class="${item.recommended ? 'pkg primary' : 'pkg'}" href="${escapeHtml(item.url)}">${escapeHtml(item.label)}<span class="size">${formatSize(item.size)}</span></a>`
        ).join('')
        return `<div class="arch"><h4>${ARCH_LABELS[arch]}</h4><div class="pkgs">${links}</div></div>`
      }).join('')

    return `<section class="card" data-os="${os}">
        <h3>${name}</h3>
        ${rows || `<p class="empty">No ${name} build in this release.</p>`}
      </section>`
  }).join('')

  const sums = release.assets?.find((asset) => asset.name === 'SHA256SUMS')
  const date = release.published_at ? release.published_at.slice(0, 10) : ''

  return `<p class="release-meta">
      <a href="${escapeHtml(release.html_url)}">${escapeHtml(release.tag_name)}</a>${release.prerelease ? ' <span class="badge">pre-release</span>' : ''}
      ${date ? `<span class="muted">published ${escapeHtml(date)}</span>` : ''}
      ${sums ? `<a class="muted" href="${escapeHtml(sums.browser_download_url)}">SHA256SUMS</a>` : ''}
    </p>
    <div class="cards">${cards}</div>`
}

async function readReleases(path) {
  if (!path) {
    return []
  }

  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    console.warn(`Could not read releases from ${path}: ${error.message}`)
    return []
  }
}

async function main() {
  const release = pickRelease(await readReleases(process.argv[2]))
  const template = await readFile(join(siteDir, 'index.html'), 'utf8')

  const html = template
    .replace('{{DOWNLOADS}}', renderDownloads(release))
    .replaceAll('{{REPO_URL}}', REPO_URL)

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'index.html'), html)
  await copyFile(join(siteDir, 'style.css'), join(outDir, 'style.css'))
  await copyFile(join(rootDir, '_icons', 'icon.svg'), join(outDir, 'icon.svg'))
  await writeFile(join(outDir, '.nojekyll'), '')

  console.log(`Site built in ${outDir} (${release ? `release ${release.tag_name}` : 'no release'})`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
