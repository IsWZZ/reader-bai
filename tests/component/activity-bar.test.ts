import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ActivityBar from '@renderer/components/ActivityBar.vue'

const mountBar = (
  isLibraryOpen = false,
  isAssistantOpen = false,
  settingsOpen = false
): VueWrapper => mount(ActivityBar, { props: { isLibraryOpen, isAssistantOpen, settingsOpen } })

describe('ActivityBar', () => {
  it('emits toggleLibrary when the library button is clicked', async () => {
    const wrapper = mountBar(true)

    await wrapper.get('button[aria-label="论文库"]').trigger('click')

    expect(wrapper.emitted('toggleLibrary')).toHaveLength(1)
    expect(wrapper.get('button[aria-label="论文库"]').attributes('aria-pressed')).toBe('true')
  })

  it('emits toggleAssistant and reflects the open state', async () => {
    const wrapper = mountBar(false, true)

    const button = wrapper.get('button[aria-label="辅助面板"]')
    expect(button.attributes('aria-pressed')).toBe('true')

    await button.trigger('click')

    expect(wrapper.emitted('toggleAssistant')).toHaveLength(1)
  })

  it('asks the shell to open settings and reflects the open state', async () => {
    const wrapper = mountBar(false, false, true)
    const button = wrapper.get('button[aria-label="设置"]')
    expect(button.attributes('aria-pressed')).toBe('true')

    await button.trigger('click')

    expect(wrapper.emitted('openSettings')).toHaveLength(1)
  })
})
