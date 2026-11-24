import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { Languages } from 'lucide-vue-next'
import RightSidebar from '@renderer/components/RightSidebar.vue'

describe('RightSidebar', () => {
  it('renders the view label, title and slot content', () => {
    const wrapper = mount(RightSidebar, {
      props: {
        width: 320,
        maxWidth: 'calc((100% - 360px) / 2)',
        label: '论文信息',
        title: '论文信息'
      },
      slots: { default: '<p>panel body</p>' }
    })

    expect(wrapper.attributes('aria-label')).toBe('论文信息')
    expect(wrapper.attributes('style')).toContain('width: 320px')
    expect(wrapper.attributes('style')).toContain('max-width')
    expect(wrapper.get('h2').text()).toBe('论文信息')
    expect(wrapper.text()).toContain('panel body')
  })

  it('renders the icon and header actions', () => {
    const wrapper = mount(RightSidebar, {
      props: { width: 320, label: '翻译面板', title: '翻译', icon: Languages },
      slots: { actions: '<button aria-label="编辑">edit</button>' }
    })

    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="编辑"]').exists()).toBe(true)
  })

  it('emits close and uses the view-specific close label', async () => {
    const wrapper = mount(RightSidebar, {
      props: { width: 320, label: '翻译面板', title: '翻译', closeLabel: '关闭翻译面板' }
    })

    await wrapper.get('button[aria-label="关闭翻译面板"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('falls back to the generic close label', () => {
    const wrapper = mount(RightSidebar, {
      props: { width: 320, label: '论文信息', title: '论文信息' }
    })

    expect(wrapper.find('button[aria-label="关闭"]').exists()).toBe(true)
  })
})
