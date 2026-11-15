/* eslint-disable vue/one-component-per-file -- test stubs live together on purpose */
// Shared mount helper for Ft* component tests.
//
//   import { mountComponent } from './helpers/mount.js'
//   const wrapper = mountComponent(FtButton, { props: { label: 'Go' } })
//
// It installs what most components expect from src/renderer/main.js, in the
// smallest form that still lets tests make real assertions:
//
// - vue-i18n in Composition mode with no messages, so `$t('Some.Key')` and
//   `useI18n().t('Some.Key')` both return the key itself. Assert on keys, not on
//   English text. Pass `messages` to test interpolation with real strings.
// - FontAwesomeIcon / font-awesome-icon stubbed to <span class="fa-stub"
//   data-icon="fas times">, so icon choice is assertable without the SVG core.
// - router-link / RouterLink stubbed to a plain <a> with the `to` prop.
// - Teleport stubbed in place, so teleported content (FtTooltip) renders inside
//   the wrapper instead of needing a `.app` element on the page.
// - Optionally a Vuex store (pass `store`, e.g. from createTestStore below).
//
// Every option of @vue/test-utils' mount() still works; `global` is merged.
// Wrappers are unmounted automatically after each test.

import { afterEach } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createStore } from 'vuex'

enableAutoUnmount(afterEach)

export const FontAwesomeIconStub = defineComponent({
  name: 'FontAwesomeIcon',
  props: {
    icon: { type: [Array, String, Object], default: null },
  },
  setup(props) {
    return () => h('span', {
      class: 'fa-stub',
      'data-icon': Array.isArray(props.icon) ? props.icon.join(' ') : String(props.icon),
    })
  },
})

export const RouterLinkStub = defineComponent({
  name: 'RouterLink',
  props: {
    to: { type: [String, Object], required: true },
  },
  setup(props, { slots }) {
    return () => h('a', {
      class: 'router-link-stub',
      href: typeof props.to === 'string' ? props.to : JSON.stringify(props.to),
    }, slots.default?.())
  },
})

/**
 * @param {Record<string, any>} [messages] en-US messages; omit to have keys returned as-is
 */
export function createTestI18n(messages = {}) {
  return createI18n({
    legacy: false,
    locale: 'en-US',
    fallbackLocale: 'en-US',
    messages: { 'en-US': messages },
    // silence the "Not found key" warnings that every key-only lookup would print
    missingWarn: false,
    fallbackWarn: false,
  })
}

/**
 * Minimal Vuex store for components that read getters or dispatch actions.
 * @param {{ getters?: Record<string, any>, actions?: Record<string, Function> }} [options]
 *   `getters` are plain values, wrapped into getter functions for you.
 */
export function createTestStore({ getters = {}, actions = {} } = {}) {
  return createStore({
    getters: Object.fromEntries(Object.entries(getters).map(([name, value]) => [name, () => value])),
    actions,
  })
}

/**
 * @template T
 * @param {T} component
 * @param {import('@vue/test-utils').ComponentMountingOptions<T> & {
 *   messages?: Record<string, any>,
 *   store?: import('vuex').Store<any>,
 * }} [options]
 */
export function mountComponent(component, options = {}) {
  const { messages, store, global = {}, ...rest } = options

  const plugins = [createTestI18n(messages)]
  if (store) {
    plugins.push(store)
  }

  return mount(component, {
    ...rest,
    global: {
      ...global,
      plugins: [...plugins, ...(global.plugins ?? [])],
      stubs: {
        FontAwesomeIcon: FontAwesomeIconStub,
        'font-awesome-icon': FontAwesomeIconStub,
        RouterLink: RouterLinkStub,
        'router-link': RouterLinkStub,
        teleport: true,
        ...global.stubs,
      },
    },
  })
}
