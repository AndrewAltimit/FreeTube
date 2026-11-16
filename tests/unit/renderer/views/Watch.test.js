import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

// Watch.js pulls in the router, the store and every player component through its imports.
// The reload methods only need these helpers.
vi.mock('../../../../src/renderer/helpers/utils', () => ({
  throttle: (fn) => fn,
  showToast: vi.fn(),
}))
vi.mock('../../../../src/renderer/helpers/api/local', () => ({}))
vi.mock('../../../../src/renderer/helpers/api/invidious', () => ({}))
vi.mock('../../../../src/renderer/components/FtShakaVideoPlayer/FtShakaVideoPlayer.vue', () => ({ default: {} }))

const { default: Watch } = await import('../../../../src/renderer/views/Watch/Watch.js')

/**
 * A stand-in for the component instance, with a real router so the navigation failures are vue-router's own.
 * Like the component's `$route` watcher, every route change triggers a reload.
 * @param {number} timestamp
 */
async function createWatchContext(timestamp) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/watch/:id', component: {} }],
  })
  await router.push('/watch/abc')

  const ctx = {
    videoId: 'abc',
    sabrReloadState: null,
    t: (key) => key,
    getTimestamp: () => timestamp,
    reloadView: vi.fn(async () => {}),
    $router: router,
    get $route() { return router.currentRoute.value },
  }
  ctx.reloadAtCurrentTimestamp = Watch.methods.reloadAtCurrentTimestamp.bind(ctx)
  router.afterEach((to, from, failure) => {
    if (!failure) ctx.reloadView()
  })

  return { ctx, router }
}

describe('Watch reloads', () => {
  it('reloads once when a SABR reload changes the route to the current timestamp', async () => {
    const { ctx, router } = await createWatchContext(42)

    await Watch.methods.onSabrReloadRequested.call(ctx)

    expect(router.currentRoute.value.query.oneTimeTimestamp).toBe('42')
    expect(ctx.reloadView).toHaveBeenCalledTimes(1)
  })

  it('reloads once when the route already has the same timestamp', async () => {
    const { ctx, router } = await createWatchContext(42)
    await router.replace({ path: '/watch/abc', query: { oneTimeTimestamp: 42 } })
    ctx.reloadView.mockClear()

    await Watch.methods.onSabrReloadRequested.call(ctx)

    expect(ctx.reloadView).toHaveBeenCalledTimes(1)
  })

  it('reloads directly when there is no timestamp to resume at', async () => {
    const { ctx } = await createWatchContext(0)

    await Watch.methods.onManualReloadRequested.call(ctx)

    expect(ctx.reloadView).toHaveBeenCalledTimes(1)
  })
})
