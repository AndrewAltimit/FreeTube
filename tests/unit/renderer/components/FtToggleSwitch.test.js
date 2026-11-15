import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'

import FtToggleSwitch from '../../../../src/renderer/components/FtToggleSwitch/FtToggleSwitch.vue'
import { mountComponent } from './helpers/mount.js'

describe('FtToggleSwitch', () => {
  it('links the label to the checkbox', () => {
    const wrapper = mountComponent(FtToggleSwitch, { props: { label: 'Autoplay' } })

    const input = wrapper.get('input[type="checkbox"]')
    expect(input.attributes('id')).toBeTruthy()
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'))
    expect(wrapper.get('.switch-label-text').text()).toBe('Autoplay')
  })

  it('gives each instance in the same app a distinct id', () => {
    // useId() is unique per app, so both switches have to share one mount
    const Pair = defineComponent({
      components: { FtToggleSwitch },
      template: '<div><FtToggleSwitch label="a" /><FtToggleSwitch label="b" /></div>',
    })
    const [a, b] = mountComponent(Pair).findAll('input').map(input => input.attributes('id'))

    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it('starts from defaultValue', () => {
    expect(mountComponent(FtToggleSwitch, { props: { label: 'x' } }).get('input').element.checked).toBe(false)
    expect(mountComponent(FtToggleSwitch, { props: { label: 'x', defaultValue: true } }).get('input').element.checked).toBe(true)
  })

  it('emits the new value on change', async () => {
    const wrapper = mountComponent(FtToggleSwitch, { props: { label: 'x' } })
    const input = wrapper.get('input')

    await input.setValue(true)
    await input.setValue(false)

    expect(wrapper.emitted('change')).toEqual([[true], [false]])
  })

  it('follows defaultValue when the parent changes it', async () => {
    const wrapper = mountComponent(FtToggleSwitch, { props: { label: 'x', defaultValue: false } })

    await wrapper.setProps({ defaultValue: true })

    expect(wrapper.get('input').element.checked).toBe(true)
    // a prop change is not a user change
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('disables the input and marks the container', () => {
    const wrapper = mountComponent(FtToggleSwitch, { props: { label: 'x', disabled: true, compact: true } })

    expect(wrapper.get('input').element.disabled).toBe(true)
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['switch-ctn', 'disabled', 'compact']))
  })

  it('renders a tooltip only when one is given', () => {
    const plain = mountComponent(FtToggleSwitch, { props: { label: 'x' } })
    expect(plain.find('.selectTooltip').exists()).toBe(false)
    expect(plain.classes()).not.toContain('containsTooltip')

    const withTooltip = mountComponent(FtToggleSwitch, { props: { label: 'x', tooltip: 'Explains it' } })
    expect(withTooltip.classes()).toContain('containsTooltip')
    expect(withTooltip.find('.selectTooltip').exists()).toBe(true)
    // FtTooltip teleports its text; the helper stubs Teleport so it stays in the wrapper
    expect(withTooltip.get('[role="tooltip"]').text()).toBe('Explains it')
  })
})
