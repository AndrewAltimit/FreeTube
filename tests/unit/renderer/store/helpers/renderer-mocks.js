// Lightweight stand-ins for renderer modules that store modules reach
// transitively (src/renderer/helpers/utils.js imports both i18n and the router,
// and the router pulls in every view). Use them from hoisted vi.mock factories:
//
//   vi.mock('../../../../src/renderer/i18n/index.js', async () =>
//     (await import('./helpers/renderer-mocks.js')).createI18nMock())
//   vi.mock('../../../../src/renderer/router/index.js', async () =>
//     (await import('./helpers/renderer-mocks.js')).createRouterMock())

import { vi } from 'vitest'

export function createI18nMock() {
  const i18n = {
    global: {
      locale: { value: 'en-US' },
      t: vi.fn((key) => key),
    },
  }

  return {
    default: i18n,
    loadLocale: vi.fn(async () => undefined),
  }
}

export function createRouterMock() {
  return {
    default: {
      push: vi.fn(),
      replace: vi.fn(),
      currentRoute: { value: { path: '/', query: {}, params: {} } },
    },
  }
}
