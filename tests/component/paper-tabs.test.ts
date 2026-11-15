import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PaperTabs from '@renderer/components/PaperTabs.vue'
import type { Paper } from '@renderer/types'

const paper = (id: string, title: string): Paper => ({
  id,
  title,
  path: `/papers/${id}.pdf`,
  fileName: `${id}.pdf`,
  spaceId: null,
  titleSource: 'user',
  createdAt: 1
})

const PAPERS = [paper('a', 'Paper A'), paper('b', 'Paper B')]

const mountTabs = (activeId: string | null = 'a'): ReturnType<typeof mount> =>
  mount(PaperTabs, {
    props: { papers: PAPERS, activeId },
    slots: { default: '<div data-testid="panels" />' }
  })

describe('PaperTabs', () => {
  it('renders every open paper and marks the active one', () => {
    const wrapper = mountTabs('b')

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((tab) => tab.text())).toEqual(['Paper A', 'Paper B'])
    expect(tabs[0]?.attributes('aria-selected')).toBe('false')
    expect(tabs[1]?.attributes('aria-selected')).toBe('true')
    expect(wrapper.get('[role="tablist"]').attributes('aria-label')).toBe('已打开的论文')
  })

  it('emits the selected tab', async () => {
    const wrapper = mountTabs()

    // TabsTrigger 在左键 mousedown 时切换选中项
    await wrapper.findAll('[role="tab"]')[1]?.trigger('mousedown', { button: 0 })

    expect(wrapper.emitted('select')?.[0]).toEqual(['b'])
  })

  it('emits close without changing the selection', async () => {
    const wrapper = mountTabs()

    await wrapper.get('button[aria-label="关闭 Paper B"]').trigger('click')

    expect(wrapper.emitted('close')?.[0]).toEqual(['b'])
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('renders the reader panels provided by the shell', () => {
    const wrapper = mountTabs()

    expect(wrapper.find('[data-testid="panels"]').exists()).toBe(true)
  })
})
