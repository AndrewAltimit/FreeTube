import { describe, expect, it } from 'vitest'

import FtRefreshWidget from '../../../../src/renderer/components/FtRefreshWidget/FtRefreshWidget.vue'
import { mountComponent } from './helpers/mount.js'

function mountWidget(props = {}) {
  return mountComponent(FtRefreshWidget, { props: { title: 'Live', ...props } })
}

describe('FtRefreshWidget', () => {
  it('emits click when idle', async () => {
    const wrapper = mountWidget()

    expect(wrapper.find('.refreshButton.refreshing').exists()).toBe(false)
    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('spins, reports busy and ignores clicks while refreshing', async () => {
    const wrapper = mountWidget({ refreshing: true })

    expect(wrapper.find('.refreshButton.refreshing').exists()).toBe(true)
    expect(wrapper.get('.refreshButton').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('button').attributes('title')).toBe('Feed.Refreshing Feed')

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('click')).toBeUndefined()
  })
})
