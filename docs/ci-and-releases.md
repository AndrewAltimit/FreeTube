# CI and releases

The fork's GitHub Actions: the gate on every pull request and push to `main`, and the tagged release pipeline. Upstream's workflows that these replace are gone from [`.github/workflows-disabled/`](../.github/workflows-disabled/README.md); the rest stay parked there, along with the fork's own Pages workflow.

| Workflow | Runs on | Does |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | PRs, pushes to `main` | `lint`, `test`, `pack`, `pack:web` |
| [`release.yml`](../.github/workflows/release.yml) | `v*` tag pushes, manual dispatch | Gate, six platform builds, one GitHub release |

## The runner

Every job that can runs on the maintainer's self-hosted runner, selected with `runs-on: [self-hosted, Linux, ARM64]`. It is an **arm64 Linux** machine shared with the maintainer's other projects, so jobs on it queue one at a time.

Node and pnpm come from `actions/setup-node` and `pnpm/action-setup` on every run, at the versions upstream's workflows used (Node 24, pnpm 11), so the runner needs no Node install of its own. Action references are pinned to commit SHAs.

The Linux release builds need two system packages that the workflow cannot install itself (no root). Provision the runner once:

```bash
sudo apt install rpm libarchive-tools
```

[`_scripts/ci/check-linux-packaging-host.sh`](../_scripts/ci/check-linux-packaging-host.sh) runs at the start of each Linux build and fails with that command if either is missing.

## CI

`ci.yml` runs the gate the root `CLAUDE.md` names: `pnpm run lint`, `pnpm test`, `pnpm run pack`, `pnpm run pack:web`. A new push to a pull request cancels that PR's previous run. Tags are not handled here; `release.yml` re-runs the gate itself, so a release does not queue a second identical run on the single runner.

## Releases

### Cutting a release

```bash
git tag v0.26.0
git push origin v0.26.0
```

The tag must start with `v` plus the `version` in `package.json`, optionally followed by a suffix (`v0.26.0-fork.1`); `verify` fails otherwise, so file names always match the tag. A tag containing `-` is published as a pre-release. Bump `package.json` in a commit on `main` before tagging a new version.

A **dry run** builds everything without publishing: Actions > Release > Run workflow, give a tag, branch or commit, and leave *publish* unchecked. The packages are then downloadable as workflow artifacts for seven days.

### Jobs

| Job | Runner | Builds |
|---|---|---|
| `verify` | self-hosted | Tag/version check, `lint`, `test`, `pack:web` |
| `build-linux` | self-hosted (arm64) | `linux-x64`, `linux-arm64` |
| `build-windows` | GitHub-hosted `windows-latest` | `win-x64`, `win-arm64` |
| `build-macos` | GitHub-hosted `macos-15-intel` | `mac-x64` and `mac-arm64`, in one job |
| `publish` | self-hosted | `SHA256SUMS`, the release |

The Linux and Windows build jobs are matrices over `x64` and `arm64`, and each leg uploads its own workflow artifact (`freetube-linux-x64`, `freetube-win-arm64` and so on). macOS builds both architectures in one job and uploads them as `freetube-mac`, for the reason in the next section. `publish` waits for `verify` and every build leg, checks that every OS/architecture pair produced every package listed below, writes `SHA256SUMS`, and makes the single release edit with the runner's `gh`. A release therefore never appears with a platform missing or ahead of the gate. The hosted builds start alongside `verify` instead of after it, since nothing is published until it passes.

### Why Windows and macOS build on hosted runners

electron-builder ships arm64-hosted builds of fpm and the AppImage tools, so both Linux architectures package on the arm64 runner. The x64 Linux build is a cross-package: it downloads the x64 Electron and packs it, compiling nothing.

Windows and macOS cannot build on the runner the same way. A macOS build needs Apple's SDK, which cannot be put on a Linux machine. For Windows, the NSIS compiler (`makensis`) and the resource tooling electron-builder runs are not reliable on an arm64 Linux host. Both therefore build on GitHub-hosted runners, as upstream's builds do. Hosted minutes are free for a public repository.

`build-macos` runs on `macos-15-intel`, not `macos-latest`. `macos-latest` is an arm64 runner, and GitHub's arm64 macOS pool often runs short: a job that waits too long for one is never started and is cancelled, and `publish` then skips, so the release fails. The Intel image draws from a separate pool. FreeTube has no native modules, so the arm64 package is a cross-package there, the same as x64 Linux on the arm64 runner. Both architectures build in one job, one after the other, so a release needs only one macOS runner. GitHub retires its last Intel macOS image in August 2027, so this job has to move back to an arm64 label before then. If a release still fails this way, re-run only the failed jobs; the other builds' artifacts are kept for seven days.

### Packages

File names come from `artifactName` in [`_scripts/ebuilder.config.mjs`](../_scripts/ebuilder.config.mjs): `freetube-<version>-<os>-<arch>.<ext>`, with `-setup` before `.exe` on Windows. electron-builder leaves the architecture out of x64 names by default, which would make the x64 and arm64 packages of one OS collide in one release.

The AppImage, deb and rpm targets substitute their distro's architecture spelling for `${arch}` (`x86_64`, `amd64`, `aarch64`) whatever the pattern says, so `build-linux` renames those files to the `x64`/`arm64` form after building. That step then checks the leg produced all three Linux packages, since `upload-artifact` only fails when no file at all matches.

| OS | Packages per architecture |
|---|---|
| Linux | `.AppImage`, `.deb`, `.rpm` |
| Windows | `-setup.exe` (NSIS) |
| macOS | `.dmg` |

The fork builds one package per format people install from. Upstream also builds portable, zip and 7z archives and an Arch `.pacman`. The fork leaves them out: they repeat the packages above (the in-app updater below installs from these packages, not from a macOS zip), and they roughly tripled the size and upload time of a release.

macOS builds are ad-hoc signed (`identity: '-'` in the builder config), not notarised; Gatekeeper asks the user to confirm the first launch. Nothing is code-signed on Windows.

### In-app updates

The update banner (`checkForNewUpdates` in `src/renderer/App.vue`) compares this build's version with the newest release. When the main process can update this install, the banner and the release notes offer **Install Update**. The renderer passes only the version over IPC (`INSTALL_UPDATE`). `src/main/updater.js` looks that release up through the GitHub API, picks the package for this install, downloads it through the app's session (so the proxy setting applies), and refuses it unless its SHA-256 matches the release's `SHA256SUMS`. Asset selection and checksum parsing live in `src/main/updateAssets.js`, which accepts only download URLs under this repository's releases, and are unit tested in `tests/unit/main/updateAssets.test.js`. Renaming packages or dropping `SHA256SUMS` breaks the updater.

| Install | Detected by | Install step |
|---|---|---|
| Windows | `process.platform` | Runs the NSIS installer with `--updated /S --force-run`, which installs silently and starts the new version |
| AppImage | `APPIMAGE` env var | Swaps the file in place, then relaunches |
| deb / rpm | `dpkg -S` / `rpm -qf` own the executable | `pkexec dpkg -i` or `pkexec rpm -U`, then relaunches |
| macOS | `process.platform` | Opens the disk image; the person drags the app into Applications |

An x64 build running under ARM64 translation downloads the arm64 package. Unpackaged dev builds, Flatpak, Snap and the web build get no install button and keep the link to the release page.

### Installing at startup

With **Check for Updates** and **Install Updates on Startup** both on, the Windows installer and the AppImage update before the main window opens. `src/main/startupUpdate.js` asks GitHub for the newest release as soon as the proxy is set, so the request overlaps the rest of startup. `selectStartupUpdateVersion` in `updateAssets.js` decides whether it is newer. When it is, a small frameless splash (`src/main/splashPage.js`, a sandboxed `data:` page the main process drives through `executeJavaScript`) shows download progress, and `installUpdate` installs it the same way as the banner button; the installer restarts FreeTube. The splash also shows when the check takes longer than 400 ms.

Startup carries on normally when the check takes more than 4 s, fails or finds nothing, and when a download makes no progress for 30 s (an `AbortSignal` passed to `installUpdate`). It also carries on when FreeTube was opened with a link, because the restarted version would lose it. The other install kinds keep the banner: a disk image to drag or a password prompt at every launch isn't something to spring on someone at startup. A second instance launched while the splash is up opens no window; the startup updater opens it or quits to install.

## GitHub Pages site (parked)

The fork does not publish a Pages site. The workflow that would deploy it, `pages.yml`, is parked in [`.github/workflows-disabled/`](../.github/workflows-disabled/README.md), and `release.yml` does not trigger it. The site's source stays in the repo and is still tested, so it can be switched back on by moving `pages.yml` into `.github/workflows/` and adding back a last `publish` step that runs `gh workflow run pages.yml --ref main` (with `actions: write` on that job).

The site's source is [`site/`](../site/): `index.html` (a template), `style.css`, and `build.mjs`, which writes the finished site to `site/dist/` (gitignored). `build.mjs` takes the JSON from `GET /repos/{owner}/{repo}/releases`, picks the newest published release (falling back to a pre-release when there is no full release), and renders its assets into the download table. The page makes no API calls of its own; every download link is plain HTML. Its one script highlights the visitor's OS card from the browser's platform string.

To preview locally:

```bash
gh api repos/AndrewAltimit/FreeTube/releases > releases.json
node site/build.mjs releases.json      # without the argument: the no-release page
```

When enabled, `pages.yml` deploys on pushes to `main` that touch `site/`, on manual dispatch, and when started by a release. A release made with `GITHUB_TOKEN` fires no `release` event for other workflows, which is why the release has to start it with `gh workflow run`; `workflow_dispatch` is the one event that token can trigger. The repository's Pages source must be set to **GitHub Actions** (Settings > Pages).

The asset-name pattern `build.mjs` parses is tested against the builder config's `artifactName` patterns in `tests/unit/site/build.test.js`, so renaming packages in one place without the other fails the suite.
