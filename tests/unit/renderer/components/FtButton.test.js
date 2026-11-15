import { describe, expect, it } from 'vitest'

import FtButton from '../../../../src/renderer/components/FtButton/FtButton.vue'
import { mountComponent } from './helpers/mount.js'

describe('FtButton', () => {
  it('renders the label and exposes it for settings search', () => {
    const wrapper = mountComponent(FtButton, { props: { label: 'Save' } })

    const button = wrapper.get('button')
    expect(button.text()).toBe('Save')
    expect(button.attributes('data-settings-search-label')).toBe('Save')
  })

  it('uses the accent colour variables by default', () => {
    const style = mountComponent(FtButton).get('button').attributes('style')

    expect(style).toContain('color: var(--text-with-accent-color)')
    expect(style).toContain('background-color: var(--accent-color)')
    expect(style).toContain('border-color: var(--accent-color)')
  })

  it('applies custom text and background colours', () => {
    const wrapper = mountComponent(FtButton, {
      props: { textColor: 'red', backgroundColor: 'blue' },
    })

    const style = wrapper.get('button').attributes('style')
    expect(style).toContain('color: red')
    expect(style).toContain('background-color: blue')
    expect(style).toContain('border-color: blue')
  })

  it('renders an icon only when one is given', () => {
    expect(mountComponent(FtButton, { props: { label: 'x' } }).find('.fa-stub').exists()).toBe(false)

    const wrapper = mountComponent(FtButton, { props: { label: 'x', icon: ['fas', 'plus'] } })
    expect(wrapper.get('.fa-stub').attributes('data-icon')).toBe('fas plus')
  })

  it('replaces the default content with the slot', () => {
    const wrapper = mountComponent(FtButton, {
      props: { label: 'ignored', icon: ['fas', 'plus'] },
      slots: { default: '<em>custom</em>' },
    })

    expect(wrapper.get('button').html()).toContain('<em>custom</em>')
    expect(wrapper.find('.fa-stub').exists()).toBe(false)
    expect(wrapper.get('button').text()).toBe('custom')
  })

  it('emits click with no payload each time it is clicked', async () => {
    const wrapper = mountComponent(FtButton, { props: { label: 'Go' } })

    await wrapper.get('button').trigger('click')
    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('click')).toEqual([[], []])
  })
})
