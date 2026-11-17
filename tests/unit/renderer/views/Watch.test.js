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

describe('Watch 403 retries', () => {
  /** @param {number} timestamp */
  async function createForbiddenContext(timestamp) {
    const { ctx, router } = await createWatchContext(timestamp)
    Object.assign(ctx, {
      forbiddenRetryState: null,
      forbiddenRetryTimeout: null,
      errorMessage: null,
      customErrorIcon: null,
      videoGenreIsMusic: false,
      streamingDataExpiryDate: new Date(Date.now() + 60 * 60_000),
      handleWatchProgressAutoSaveWhenProgressEnabled: vi.fn(),
      handleActiveFormatUnavailable: vi.fn(),
    })
    ctx.retryAfterForbidden = Watch.methods.retryAfterForbidden.bind(ctx)
    return { ctx, router }
  }

  const forbidden = { code: 1001, data: ['https://rr1---sn-x.googlevideo.com/videoplayback', 403] }

  it('reloads at the time of the error instead of showing it', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, router } = await createForbiddenContext(42)
      Watch.methods.handlePlayerError.call(ctx, forbidden)

      expect(ctx.errorMessage).toBeNull()
      expect(ctx.reloadView).not.toHaveBeenCalled()

      // The player's position is gone by the time the retry runs
      ctx.getTimestamp = () => 0
      await vi.advanceTimersByTimeAsync(2_000)

      expect(router.currentRoute.value.query.oneTimeTimestamp).toBe('42')
      expect(ctx.reloadView).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the error once the retries are used up', async () => {
    const { ctx } = await createForbiddenContext(42)
    ctx.forbiddenRetryState = { videoId: 'abc', count: 3, lastRetryAt: Date.now() }

    Watch.methods.handlePlayerError.call(ctx, forbidden)

    expect(ctx.errorMessage).toContain('403')
    clearTimeout(ctx.forbiddenRetryTimeout)
  })

  it('drops the retry when the video changes while waiting', async () => {
    vi.useFakeTimers()
    try {
      const { ctx } = await createForbiddenContext(42)
      Watch.methods.handlePlayerError.call(ctx, forbidden)
      ctx.videoId = 'xyz'
      await vi.advanceTimersByTimeAsync(2_000)

      expect(ctx.reloadView).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
