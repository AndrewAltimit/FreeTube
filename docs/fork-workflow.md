# Fork workflow

How this fork relates to upstream [FreeTubeApp/FreeTube](https://github.com/FreeTubeApp/FreeTube) and how changes land.

## Branches

- `main` is the only long-lived branch. Upstream's `development` is not used here.
- Each change gets a feature branch off `main` (for example `fix/subscription-reload`) and merges back by pull request.
- Keep branches short-lived and focused on one bug or feature; that keeps upstream syncs easy to reason about.

## Syncing from upstream

Upstream is pulled in, never pushed to:

```bash
git remote add upstream https://github.com/FreeTubeApp/FreeTube.git   # once per clone
git fetch upstream
git switch -c sync/upstream-<short-desc> main
git merge upstream/development
```

Resolve conflicts on the sync branch, run `pnpm install && pnpm run lint`, smoke-test the app, then merge the sync branch into `main`.

- **Merge, don't rebase.** `main` is shared history; a merge keeps upstream's commits intact and makes the next sync's merge base obvious.
- **When upstream fixes a bug this fork already fixed,** prefer upstream's version in the conflict and drop the fork's, unless the fork's fix is clearly better. Fewer divergent lines mean cheaper future syncs.
- **Translations** only come in this way ([`localization.md`](localization.md)).

## CI

All of upstream's workflows are parked in [`.github/workflows-disabled/`](../.github/workflows-disabled/README.md) and nothing runs. CI is being rebuilt for the maintainer's self-hosted runner. Until then, the gate is upstream's CI run by hand: `pnpm run lint && pnpm run pack && pnpm run pack:web`. The lefthook pre-commit hook covers only the lint part, on staged files.

## Commits and PRs

- The commit subject says what changed; the body says why, and names the upstream issue when a fix targets one (`FreeTubeApp/FreeTube#1234`).
- PRs into `main` use the [PR template](../.github/PULL_REQUEST_TEMPLATE.md): summary, related issue, how it was tested (which API, which build, which OS).
- Don't open PRs or comment on upstream on the fork's behalf.
