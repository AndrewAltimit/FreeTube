# Disabled workflows

Every GitHub Actions workflow and workflow config inherited from upstream [FreeTubeApp/FreeTube](https://github.com/FreeTubeApp/FreeTube) is parked here. GitHub only runs workflows from `.github/workflows/`, so nothing in this folder runs.

They are kept as a reference for the planned CI rebuild, which will run on the maintainer's self-hosted runner (`runs-on: self-hosted`), the same setup as the maintainer's other projects. Until then, this fork has no CI.

| File | Upstream purpose |
|---|---|
| `build.yml` | Build the app for every platform on push and PR |
| `release.yml` | Build and publish release artifacts |
| `linter.yml` | ESLint / Stylelint on PRs |
| `codeql.yml` | CodeQL security scanning |
| `updateSite.yml` | Update the freetubeapp.io site on release |
| `compress-images.yml` | Compress images in PRs |
| `autoMerge.yml`, `auto-merge.yml` | Auto-merge Dependabot PRs |
| `dependabot.yml` | Dependabot dependency-update config (only read from `.github/`, so it is off here) |
| `conflicts.yml` | Label PRs with merge conflicts |
| `label-issue.yml`, `issue-labeler.yml` | Label issues by content |
| `label-pr.yml`, `pr-labeler.yml` | Label PRs by changed paths |
| `remove-outdated-labels.yml` | Clear stale labels on close |
| `no-response.yml`, `stale.yml` | Close inactive issues and PRs |

When a workflow is rebuilt for the self-hosted runner, it goes back into `.github/workflows/` and its old copy here is deleted.
