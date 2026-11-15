// Global test setup, loaded before every test file (see vitest.config.mjs).
//
// Keep this minimal: anything a single area needs belongs in that area's
// test files or in tests/helpers/.

import { afterEach, vi } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    // storage may be unavailable in some environments
  }
})
