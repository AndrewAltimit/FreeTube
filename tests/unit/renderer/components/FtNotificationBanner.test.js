import { describe, expect, it } from 'vitest'

import FtNotificationBanner from '../../../../src/renderer/components/FtNotificationBanner/FtNotificationBanner.vue'
import { mountComponent } from './helpers/mount.js'

describe('FtNotificationBanner', () => {
  it('shows the message and describes the banner with it', () => {
    const wrapper = mountComponent(FtNotificationBanner, { props: { message: 'New version available' } })

    const message = wrapper.get('.message')
    expect(message.text()).toBe('New version available')
    expect(wrapper.attributes('title')).toBe('New version available')
    expect(wrapper.attributes('aria-describedby')).toBe(message.attributes('id'))
  })

  it('labels the close button through $t, which returns the key when no messages are loaded', () => {
    const close = mountComponent(FtNotificationBanner, { props: { message: 'm' } }).get('.closeButton')

    expect(close.attributes('aria-label')).toBe('Close Banner')
    expect(close.attributes('title')).toBe('Close Banner')
    expect(close.get('.fa-stub').attributes('data-icon')).toBe('fas times')
  })

  it('uses real translations when messages are provided', () => {
    const wrapper = mountComponent(FtNotificationBanner, {
      props: { message: 'm' },
      messages: { 'Close Banner': 'Banner schliessen' },
    })

    expect(wrapper.get('.closeButton').attributes('aria-label')).toBe('Banner schliessen')
  })

  it('emits click(true) when the banner is clicked', async () => {
    const wrapper = mountComponent(FtNotificationBanner, { props: { message: 'm' } })

    await wrapper.trigger('click')

    expect(wrapper.emitted('click')).toEqual([[true]])
  })

  it.each(['Enter', ' '])('emits click(true) on the %j key', async (key) => {
    const wrapper = mountComponent(FtNotificationBanner, { props: { message: 'm' } })

    await wrapper.trigger('keydown', { key })

    expect(wrapper.emitted('click')).toEqual([[true]])
  })

  it('emits click(false) from the close button without also opening', async () => {
    const wrapper = mountComponent(FtNotificationBanner, { props: { message: 'm' } })

    await wrapper.get('.closeButton').trigger('click')

    expect(wrapper.emitted('click')).toEqual([[false]])
  })
})
