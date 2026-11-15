# docs/ - working notes

Loaded when you work under `docs/`. Technical reference for the code and the fork's workflow, organized by topic; no progress tracker, session log or status tables.

## Where a page is indexed

Every page has a row in [`README.md`](README.md). A new page adds its row there, not in the root `CLAUDE.md`, which keeps only the rules, commands and cross-cutting traps every session needs. If a page grows a section that every session needs, add a one-line trap to the root `CLAUDE.md` that links to it.

## Writing rules

- Present tense. State what a module, flow or format **is**, not when or how it was figured out.
- No session numbers, dates, "fixed in session N" markers, or before-vs-after narratives. Those belong in commit messages.
- No counts of project state that rot (number of components, settings, open bugs).
- Cite code by path, and by symbol where a line number would drift: `src/renderer/store/modules/settings.js`, `loadVideosForSubscriptionsFromRemote` in `components/SubscriptionsVideos.vue`.
- Operational state (which bugs are in flight, what was tried, what's next) lives in git log, issues and agent memory, not here. Don't cite agent-memory filenames from a committed doc.
- Keep prose out of table cells. A cell is a one-line "what this covers"; anything longer goes in a section on the linked page.
- Relative links only, and keep them working when you rename a heading or a file.
- Don't duplicate upstream's user docs. Link to [docs.freetubeapp.io](https://docs.freetubeapp.io/) instead.
