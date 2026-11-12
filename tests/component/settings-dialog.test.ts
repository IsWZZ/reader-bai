import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsDialog from '@renderer/components/SettingsDialog.vue'
import { useSettingsStore } from '@renderer/store/settings'
import type { AppSettings, SettingsPatch } from '@renderer/types'

const BASE_SETTINGS: AppSettings = {
  theme: 'system',
  ai: { baseUrl: '', apiKey: '' }
}

const getSettings = vi.fn<() => Promise<AppSettings>>()
const updateSettings = vi.fn<(patch: SettingsPatch) => Promise<AppSettings>>()

// DialogContent 会 Teleport 到 body，因此用 DOMWrapper 查询真实 DOM
const mountDialog = async (): Promise<VueWrapper> => {
  const wrapper = mount(SettingsDialog, {
    props: { open: true },
    attachTo: document.body
  })
  await flushPromises()
  return wrapper
}

const findButton = (label: string): DOMWrapper<HTMLButtonElement> => {
  const element = [...document.body.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label
  )
  if (!element) throw new Error(`button "${label}" not found`)
  return new DOMWrapper(element)
}

const findInput = (selector: string): DOMWrapper<HTMLInputElement> => {
  const element = document.body.querySelector<HTMLInputElement>(selector)
  if (!element) throw new Error(`input "${selector}" not found`)
  return new DOMWrapper(element)
}

describe('SettingsDialog', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    getSettings.mockReset()
    updateSettings.mockReset()
    getSettings.mockResolvedValue({ ...BASE_SETTINGS, ai: { ...BASE_SETTINGS.ai } })
    updateSettings.mockImplementation(async (patch) => ({
      theme: patch.theme ?? BASE_SETTINGS.theme,
      ai: patch.ai ?? { ...BASE_SETTINGS.ai }
    }))
    window.api = { getSettings, updateSettings } as unknown as Api

    const store = useSettingsStore()
    await store.initialize()
  })

  it('switches the theme from the appearance section', async () => {
    const wrapper = await mountDialog()

    await findButton('深色').trigger('click')
    await flushPromises()

    expect(updateSettings).toHaveBeenCalledWith({ theme: 'dark' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(useSettingsStore().theme).toBe('dark')
    wrapper.unmount()
  })

  it('saves AI settings, normalizing the base URL', async () => {
    const wrapper = await mountDialog()
    await findButton('AI 服务').trigger('click')

    await findInput('#ai-base-url').setValue('https://api.example.com/v1/')
    await findInput('#ai-api-key').setValue('  sk-test  ')
    await findButton('保存').trigger('click')
    await flushPromises()

    expect(updateSettings).toHaveBeenCalledWith({
      ai: { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' }
    })
    expect(document.body.textContent).toContain('已保存')
    wrapper.unmount()
  })

  it('rejects a non-http base URL without saving', async () => {
    const wrapper = await mountDialog()
    await findButton('AI 服务').trigger('click')

    await findInput('#ai-base-url').setValue('ftp://example.com')
    await findButton('保存').trigger('click')
    await flushPromises()

    expect(updateSettings).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Base URL 需要是以 http:// 或 https:// 开头的地址')
    wrapper.unmount()
  })

  it('emits update:open when the close button is clicked', async () => {
    const wrapper = await mountDialog()

    await findButton('关闭').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    wrapper.unmount()
  })
})
