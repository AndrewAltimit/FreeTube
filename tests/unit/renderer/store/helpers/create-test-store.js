// Builds a real Vuex store from a subset of the app's store modules, so
// getters, actions and mutations interact exactly as they do in the app
// (all modules are non-namespaced, like src/renderer/store/index.js).
//
// Store modules export their `state` as a plain object, not a factory, and
// Vuex uses that object directly. Without cloning, state would leak between
// stores (and therefore between tests), so each module's state is deep-cloned.
//
//   const store = createTestStore({
//     modules: { profiles, subscriptionCache },
//     state: { profiles: { activeProfile: 'abc' } },   // shallow overrides
//     stubs: { settings: { state: { defaultProfile: 'abc' } } },
//   })
//
// `stubs` are extra modules added verbatim (also state-cloned) to stand in for
// modules that are not under test, e.g. to provide a root action such as
// `updateQuickBookmarkTargetPlaylistId` or `rootState.settings.*`.

import { createStore } from 'vuex'

function cloneModule(module, stateOverrides) {
  const state = typeof module.state === 'function'
    ? module.state()
    : structuredClone(module.state ?? {})

  return {
    ...module,
    state: { ...state, ...structuredClone(stateOverrides ?? {}) },
  }
}

export function createTestStore({ modules = {}, state = {}, stubs = {} } = {}) {
  const built = {}

  for (const [name, module] of Object.entries({ ...stubs, ...modules })) {
    built[name] = cloneModule(module, state[name])
  }

  return createStore({ modules: built, strict: false })
}
