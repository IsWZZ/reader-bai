import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Toolbar from '@renderer/components/Toolbar.vue'

const mountToolbar = (searchQuery = ''): VueWrapper => mount(Toolbar, { props: { searchQuery } })

const searchInput = (wrapper: VueWrapper): ReturnType<VueWrapper['get']> =>
  wrapper.get('input[aria-label="搜索论文"]')

describe('Toolbar search', () => {
  it('emits the typed query', async () => {
    const wrapper = mountToolbar()

    await searchInput(wrapper).setValue('attention')

    expect(wrapper.emitted('update:searchQuery')?.[0]).toEqual(['attention'])
  })

  it('shows the current query and clears it from the button', async () => {
    const wrapper = mountToolbar('attention')

    expect((searchInput(wrapper).element as HTMLInputElement).value).toBe('attention')

    await wrapper.get('button[aria-label="清除搜索"]').trigger('click')

    expect(wrapper.emitted('update:searchQuery')?.[0]).toEqual([''])
  })

  it('clears the query with Escape', async () => {
    const wrapper = mountToolbar('attention')

    await searchInput(wrapper).trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('update:searchQuery')?.[0]).toEqual([''])
  })

  it('hides the clear button when the query is empty', () => {
    const wrapper = mountToolbar()

    expect(wrapper.find('button[aria-label="清除搜索"]').exists()).toBe(false)
  })
})
