import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import ActivityBar from '@renderer/components/ActivityBar.vue'

const SettingsDialogStub = defineComponent({
  name: 'SettingsDialog',
  props: { open: { type: Boolean, required: true } },
  emits: ['update:open'],
  template: '<div data-test="settings-dialog" />'
})

const mountBar = (isLibraryOpen = false, isAssistantOpen = false): VueWrapper =>
  mount(ActivityBar, {
    props: { isLibraryOpen, isAssistantOpen },
    global: {
      stubs: { SettingsDialog: SettingsDialogStub }
    }
  })

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

  it('opens the settings dialog from the settings button', async () => {
    const wrapper = mountBar()
    const dialog = wrapper.getComponent(SettingsDialogStub)
    expect(dialog.props('open')).toBe(false)

    await wrapper.get('button[aria-label="设置"]').trigger('click')

    expect(dialog.props('open')).toBe(true)
    expect(wrapper.get('button[aria-label="设置"]').attributes('aria-pressed')).toBe('true')
  })

  it('closes the settings dialog when it emits update:open', async () => {
    const wrapper = mountBar()
    await wrapper.get('button[aria-label="设置"]').trigger('click')

    wrapper.getComponent(SettingsDialogStub).vm.$emit('update:open', false)
    await wrapper.vm.$nextTick()

    expect(wrapper.getComponent(SettingsDialogStub).props('open')).toBe(false)
  })
})
