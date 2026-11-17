/* eslint-disable vue/one-component-per-file -- test stubs live together on purpose */
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, onMounted } from 'vue'

import { mountComponent } from './helpers/mount.js'

vi.mock('../../../../src/renderer/store/index', () => ({
  default: { getters: { getListType: 'grid' } },
}))

const { default: FtElementList } = await import('../../../../src/renderer/components/FtElementList/FtElementList.vue')

/** Records the videoId of every card that is created, so remounts are visible */
function createWrapperStub(mounted) {
  return defineComponent({
    name: 'FtListLazyWrapper',
    props: { data: { type: Object, required: true } },
    setup(props) {
      onMounted(() => mounted.push(props.data.videoId))
      return () => h('div', { class: 'card' }, props.data.videoId)
    },
  })
}

function mountList(data, mounted) {
  return mountComponent(FtElementList, {
    props: { data },
    global: {
      stubs: {
        FtListLazyWrapper: createWrapperStub(mounted),
        FtAutoGrid: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
      },
    },
  })
}

const video = (videoId, extra = {}) => ({ type: 'video', videoId, ...extra })

describe('FtElementList', () => {
  it('keeps existing cards when new items arrive at the top of the list', async () => {
    const mounted = []
    const wrapper = mountList([video('a'), video('b')], mounted)
    expect(mounted).toEqual(['a', 'b'])

    await wrapper.setProps({ data: [video('new'), video('a'), video('b')] })

    expect(mounted).toEqual(['a', 'b', 'new'])
    expect(wrapper.findAll('.card').map(c => c.text())).toEqual(['new', 'a', 'b'])
  })

  it('moves cards when the list is reordered instead of rebuilding them', async () => {
    const mounted = []
    const wrapper = mountList([video('a'), video('b'), video('c')], mounted)

    await wrapper.setProps({ data: [video('c'), video('a'), video('b')] })

    expect(mounted).toEqual(['a', 'b', 'c'])
    expect(wrapper.findAll('.card').map(c => c.text())).toEqual(['c', 'a', 'b'])
  })

  it('renders an item that appears twice as two cards', () => {
    const mounted = []
    const wrapper = mountList([video('a'), video('a'), video('b')], mounted)

    expect(wrapper.findAll('.card').map(c => c.text())).toEqual(['a', 'a', 'b'])
  })
})
