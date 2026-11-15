# src/renderer/ - working notes

Loaded when you work in the Vue renderer. Architecture is in [`docs/architecture.md`](../../docs/architecture.md); store and DB flow in [`docs/state-and-persistence.md`](../../docs/state-and-persistence.md).

## Components and views

- New components use `<script setup>` (Composition API), the style nearly every existing component already uses.
- A component with styles gets its own folder: `components/FtThing/FtThing.vue` plus `FtThing.css` or `.scss`. Shared Sass lives in `scss-partials/`. Reusable UI primitives are prefixed `Ft`.
- Views (`views/`) are route targets, registered in `router/index.js`. Some older views still split their logic into a sibling `.js` file (`views/Watch/Watch.js`); follow the existing file's style when editing it rather than converting it.
- Untrusted HTML (descriptions, comments, posts) is rendered only through the `v-safer-html` directive (`directives/vSaferHtml.js`, DOMPurify), never `v-html`.
- Icons go through Font Awesome. Register a new icon in the `library.add(...)` call in `main.js`; `fontawesome-minimal.js` is a webpack alias that trims the core library, not the icon list.

## Data access

- Use the store (`store/modules/`) for anything persisted; don't import from `datastores/` in components.
- Electron-only calls go through `window.ftElectron` behind `process.env.IS_ELECTRON`. Local-API calls go behind `process.env.SUPPORTS_LOCAL_API` with an Invidious path.
- API helpers return normalized objects; when a field is missing for one backend, fix it in that backend's normalizer in `helpers/api/`, not at the call site.

## Strings

Every user-visible string uses `$t(...)` / `t(...)` with a static key in `static/locales/en-US.yaml` ([`docs/localization.md`](../../docs/localization.md)). Lint fails on raw text.
