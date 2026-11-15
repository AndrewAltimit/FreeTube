import { describe, expect, it, vi } from 'vitest'

import FtAgeRestricted from '../../../../src/renderer/components/FtAgeRestricted/FtAgeRestricted.vue'
import { mountComponent } from './helpers/mount.js'

// helpers/utils imports the router (and through it every view), which is far
// more than this component needs. Mock just the helper it uses; this is the
// pattern for any component that pulls in helpers/utils.
vi.mock('../../../../src/renderer/helpers/utils', () => ({
  randomArrayItem: (array) => array[0],
}))

describe('FtAgeRestricted', () => {
  it('shows the video message through useI18n by default', () => {
    const wrapper = mountComponent(FtAgeRestricted)

    expect(wrapper.get('.message').text()).toBe('Age Restricted.This video is age restricted')
  })

  it('shows the channel message when isChannel is set', () => {
    const wrapper = mountComponent(FtAgeRestricted, { props: { isChannel: true } })

    expect(wrapper.get('.message').text()).toBe('Age Restricted.This channel is age restricted')
  })

  it('resolves nested keys against real messages', () => {
    const wrapper = mountComponent(FtAgeRestricted, {
      messages: { 'Age Restricted': { 'This video is age restricted': 'Nope, too young' } },
    })

    expect(wrapper.get('.message').text()).toBe('Nope, too young')
  })

  it('shows the emoji chosen by randomArrayItem', () => {
    expect(mountComponent(FtAgeRestricted).get('.frown').text()).toBe('\u{1F635}')
  })
})
