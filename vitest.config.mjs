import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

// Mirrors the module resolution and compile-time flags of
// _scripts/webpack.renderer.config.js closely enough to import renderer code.
//
// The app reads build flags as `process.env.X`, but webpack's DefinePlugin
// inlines them as literals. Vite's `define` cannot do that for process.env:
// Vitest copies such entries into the real environment as *strings*, so
// `process.env.IS_ELECTRON` would be the truthy string 'false'. The plugin
// below does a textual replacement instead, matching webpack's behaviour.
//
// Tests run as the renderer with the Local API available but WITHOUT Electron,
// so nothing reaches for window.ftElectron unless a test stubs it.
const BUILD_FLAGS = {
  IS_ELECTRON: false,
  IS_ELECTRON_MAIN: false,
  SUPPORTS_LOCAL_API: true,
  LOCALE_NAMES: {},
  GEOLOCATION_NAMES: [],
  SHAKA_LOCALE_MAPPINGS: [],
  SHAKA_LOCALES_PREBUNDLED: [],
}

const flagPattern = new RegExp(String.raw`\bprocess\.env\.(${Object.keys(BUILD_FLAGS).join('|')})\b`, 'g')

function inlineBuildFlags () {
  return {
    name: 'freetube-inline-build-flags',
    enforce: 'pre',
    transform (code, id) {
      if (id.includes('node_modules') || !flagPattern.test(code)) {
        return null
      }
      flagPattern.lastIndex = 0
      return {
        code: code.replace(flagPattern, (_, name) => `(${JSON.stringify(BUILD_FLAGS[name])})`),
        map: null,
      }
    },
  }
}

export default defineConfig({
  plugins: [inlineBuildFlags(), vue()],
  define: {
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    __VUE_I18N_LEGACY_API__: 'false',
    __VUE_I18N_FULL_INSTALL__: 'false',
    __INTLIFY_PROD_DEVTOOLS__: 'false',
  },
  resolve: {
    alias: [
      // Store modules import DB handlers through this alias. Point it at the
      // web handlers; tests that touch the store mock
      // src/datastores/handlers/index.js instead of hitting NeDB.
      { find: /^DB_HANDLERS_ELECTRON_RENDERER_OR_WEB$/, replacement: r('./src/datastores/handlers/web.js') },
      // Only exists inside Electron; see the stub for what it provides.
      { find: /^electron\/renderer$/, replacement: r('./tests/stubs/electron-renderer.js') },
      { find: /^youtubei\.js$/, replacement: 'youtubei.js/web' },
      { find: /^shaka-player$/, replacement: 'shaka-player/dist/shaka-player.ui-es2021.js' },
      { find: /^@fortawesome\/fontawesome-svg-core$/, replacement: r('./src/renderer/fontawesome-minimal.js') },
    ],
    extensions: ['.mjs', '.js', '.vue', '.json'],
  },
  test: {
    include: ['tests/**/*.test.{js,mjs}'],
    environment: 'happy-dom',
    setupFiles: ['tests/setup.js'],
    // Vitest 5's restoreMocks only restores vi.spyOn spies; mockReset also
    // clears mockReturnValue / mockRejectedValue set on vi.fn between tests.
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
  },
})
