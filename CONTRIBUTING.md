# Contributing

This repository does not accept external contributions. It is a single-maintainer fork of [FreeTubeApp/FreeTube](https://github.com/FreeTubeApp/FreeTube), and all code changes are authored by AI agents (primarily Claude Code) operating under human direction.

## Why this fork exists

Upstream FreeTube moves slowly, and some bugs have been open for a long time (for example, the subscription reload issues). This fork uses AI-assisted workflows to fix those long-standing bugs directly instead of waiting on upstream.

Upstream's contribution policy rejects AI-authored pull requests. This fork's whole workflow is built on them, so the two projects are kept separate: changes here are not sent upstream as pull requests, and this fork is not affiliated with or endorsed by the FreeTube team.

## No External Contributions

This is a single-maintainer project. The workflow, CI (being rebuilt for a self-hosted runner) and review process are designed around agent authorship with human oversight. Pull requests from outside parties will be closed without review.

## No Feature Requests or Support

Feature requests, guidance, consulting and support are not provided. This policy is not negotiable.

## What You Can Do

- **Use upstream.** For official builds, support, translations and community, go to [FreeTubeApp/FreeTube](https://github.com/FreeTubeApp/FreeTube) and [freetubeapp.io](https://freetubeapp.io/). Please do not report this fork's bugs there.
- **Fork it.** Clone the repo and adapt it however you want, under the terms of the license.
- **Use it.** FreeTube, and therefore this fork, is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). You use it at your own risk and without any expectation of support, maintenance or acknowledgment from the maintainer.

## Development setup

For working on the code locally, upstream's [getting started guide](https://docs.freetubeapp.io/development/getting-started/) still applies:

```bash
pnpm install
pnpm run dev        # run the app in development mode
pnpm run lint       # ESLint + Stylelint (lint-fix to auto-fix)
```
