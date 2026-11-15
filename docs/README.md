# Docs

Technical reference for this fork: how the code is built, how state moves through it, and how the fork is maintained. User-facing documentation (install, FAQ, features) is upstream's at [docs.freetubeapp.io](https://docs.freetubeapp.io/).

A new page gets a row here, not in the root [`CLAUDE.md`](../CLAUDE.md).

| Page | Covers |
|---|---|
| [`architecture.md`](architecture.md) | The three Electron processes, the build targets and their compile-time flags, how IPC is wired, the two extractor APIs. |
| [`state-and-persistence.md`](state-and-persistence.md) | Vuex modules, the NeDB databases, the electron / web handler split, cross-window sync. |
| [`localization.md`](localization.md) | Where strings live, what lint enforces, how translations arrive from upstream's Weblate. |
| [`fork-workflow.md`](fork-workflow.md) | Branches, syncing from upstream, CI status, commit conventions. |
