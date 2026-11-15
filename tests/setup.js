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

// Never let a test open file-backed NeDB. src/datastores/index.js creates
// datastores at import time, and outside Electron it uses relative file paths,
// so any test that reaches it through the web DB handlers would write *.db
// files into the working directory. Swap in in-memory stores for every test.
// A test file that needs fresh stores per test mocks the module itself, which
// takes precedence over this one.
vi.mock('../src/datastores/index.js', async () => {
  const { default: Datastore } = await import('@seald-io/nedb')
  const create = () => new Datastore({ inMemoryOnly: true, autoload: true })
  return {
    settings: create(),
    profiles: create(),
    playlists: create(),
    history: create(),
    searchHistory: create(),
    subscriptionCache: create(),
  }
})
