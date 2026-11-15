import { describe, expect, it } from 'vitest'

import FtSelect from '../../../../src/renderer/components/FtSelect/FtSelect.vue'
import { mountComponent } from './helpers/mount.js'

const baseProps = {
  placeholder: 'Region',
  value: 'b',
  selectNames: ['Alpha', 'Bravo', 'Charlie'],
  selectValues: ['a', 'b', 'c'],
  icon: ['fas', 'globe'],
}

function mountSelect(props = {}) {
  return mountComponent(FtSelect, { props: { ...baseProps, ...props } })
}

describe('FtSelect', () => {
  it('renders one option per name, paired with its value', () => {
    const options = mountSelect().findAll('option')

    expect(options.map(o => [o.text(), o.attributes('value')])).toEqual([
      ['Alpha', 'a'],
      ['Bravo', 'b'],
      ['Charlie', 'c'],
    ])
  })

  it('selects the option matching value', () => {
    expect(mountSelect().get('select').element.value).toBe('b')
  })

  it('renders the placeholder as a label tied to the select, with the icon', () => {
    const wrapper = mountSelect()

    const label = wrapper.get('label')
    expect(label.text()).toBe('Region')
    expect(label.attributes('for')).toBe(wrapper.get('select').attributes('id'))
    expect(label.get('.fa-stub').attributes('data-icon')).toBe('fas globe')
  })

  it('emits the chosen value on change', async () => {
    const wrapper = mountSelect()

    await wrapper.get('select').setValue('c')

    expect(wrapper.emitted('change')).toEqual([['c']])
  })

  it('hides the label and disables the select when disabled', () => {
    const wrapper = mountSelect({ disabled: true })

    expect(wrapper.find('label').exists()).toBe(false)
    expect(wrapper.get('select').element.disabled).toBe(true)
    expect(wrapper.get('select').classes()).toContain('disabled')
  })

  it('sets dir and lang on options only for the locale selector', () => {
    const normal = mountSelect().get('option')
    expect(normal.attributes('dir')).toBeUndefined()
    expect(normal.attributes('lang')).toBeUndefined()

    const locales = mountSelect({
      isLocaleSelector: true,
      value: 'system',
      selectNames: ['System', 'Deutsch'],
      selectValues: ['system', 'de'],
    }).findAll('option')
    expect(locales.map(o => o.attributes('dir'))).toEqual(['auto', 'auto'])
    // "system" is not a real language tag
    expect(locales.map(o => o.attributes('lang'))).toEqual([undefined, 'de'])
  })

  it('passes describeById through to aria-describedby', () => {
    expect(mountSelect({ describeById: 'help-text' }).get('select').attributes('aria-describedby')).toBe('help-text')
  })
})
