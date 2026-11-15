# Disabled workflows

The GitHub Actions workflows and workflow config inherited from upstream [FreeTubeApp/FreeTube](https://github.com/FreeTubeApp/FreeTube) that this fork has not rebuilt are parked here. GitHub only runs workflows from `.github/workflows/`, so nothing in this folder runs.

The fork's own CI and release workflows live in `.github/workflows/` ([`docs/ci-and-releases.md`](../../docs/ci-and-releases.md)) and replace upstream's build, release, linter and site-update workflows. What remains here is kept for reference.

The fork's own `pages.yml` is parked here too: it deploys the [`site/`](../../site/) download page to GitHub Pages, which the fork does not publish. Its header says how to switch it back on.

| File | Upstream purpose |
|---|---|
| `codeql.yml` | CodeQL security scanning |
| `compress-images.yml` | Compress images in PRs |
| `autoMerge.yml`, `auto-merge.yml` | Auto-merge Dependabot PRs |
| `dependabot.yml` | Dependabot dependency-update config (only read from `.github/`, so it is off here) |
| `conflicts.yml` | Label PRs with merge conflicts |
| `label-issue.yml`, `issue-labeler.yml` | Label issues by content |
| `label-pr.yml`, `pr-labeler.yml` | Label PRs by changed paths |
| `remove-outdated-labels.yml` | Clear stale labels on close |
| `no-response.yml`, `stale.yml` | Close inactive issues and PRs |

When a workflow is rebuilt for the self-hosted runner, it goes back into `.github/workflows/` and its old copy here is deleted.
