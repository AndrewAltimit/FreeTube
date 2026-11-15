# Localization

## Where strings live

- `static/locales/en-US.yaml` holds the source strings. It is the only locale file edited in this repo.
- Every other `static/locales/*.yaml` comes from upstream's [Weblate project](https://hosted.weblate.org/engage/free-tube/) and arrives when the fork syncs with upstream. Hand-editing one makes the next sync conflict.
- `static/locales/activeLocales.json` lists the locales the app offers.
- `src/renderer/i18n/index.js` sets up `vue-i18n` with `en-US` as the fallback, plus regional fallbacks (`es-AR` → `es` → `en-US`).
- `_scripts/ProcessLocalesPlugin.js` converts the YAML at build time and live-reloads it in dev.

## What lint enforces

From `eslint.config.mjs`:

- `@intlify/vue-i18n/no-raw-text`: no literal user-visible text in templates, including `title` and `aria-*` attributes.
- `@intlify/vue-i18n/no-dynamic-keys`: keys must be static strings, so they can be checked against the locale file.
- `@intlify/vue-i18n/no-duplicate-keys-in-locale`.

## Fork-only strings

A string this fork adds has no translation until someone adds it upstream, and nobody will. Other locales fall back to English for it. That is acceptable, but keep the number of fork-only strings small, and put them in their own clearly named keys so an upstream sync doesn't collide with them.
