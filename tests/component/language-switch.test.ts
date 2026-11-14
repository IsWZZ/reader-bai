import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ActivityBar from '@renderer/components/ActivityBar.vue'
import { setLocale } from '@renderer/lib/i18n'
import { useSettingsStore } from '@renderer/store/settings'
import type { AppSettings, SettingsPatch } from '@renderer/types'

const BASE_SETTINGS: AppSettings = {
  theme: 'light',
  language: 'zh',
  ai: { profiles: [], activeId: '' },
  library: { directory: '/tmp/reader-bai-papers', autoAnalyze: true },
  keyStorage: 'encrypted'
}

// ActivityBar 内部就是活动栏 + 设置弹窗，用来验证语言切换同时作用于两处
const mountBar = (): VueWrapper =>
  mount(ActivityBar, {
    props: { isLibraryOpen: true, isAssistantOpen: false },
    attachTo: document.body
  })

const findButton = (label: string): DOMWrapper<HTMLButtonElement> => {
  const element = [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === label
  )
  if (!element) throw new Error(`button "${label}" not found`)
  return new DOMWrapper(element)
}

const findAriaButton = (label: string): HTMLButtonElement | null =>
  document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

const findAriaButtonOrThrow = (label: string): DOMWrapper<HTMLButtonElement> => {
  const element = findAriaButton(label)
  if (!element) throw new Error(`button with aria-label "${label}" not found`)
  return new DOMWrapper(element)
}

describe('interface language switching', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    setLocale('zh')

    let current = structuredClone(BASE_SETTINGS)
    window.api = {
      getSettings: vi.fn(async () => structuredClone(current)),
      updateSettings: vi.fn(async (patch: SettingsPatch) => {
        current = {
          ...current,
          theme: patch.theme ?? current.theme,
          language: patch.language ?? current.language
        }
        return structuredClone(current)
      })
    } as unknown as Api

    await useSettingsStore().initialize()
  })

  afterEach(() => {
    setLocale('zh')
  })

  it('updates text outside the settings dialog immediately after choosing English', async () => {
    const wrapper = mountBar()
    await flushPromises()

    // 切换前：活动栏和设置弹窗都是中文
    expect(findAriaButton('设置')).not.toBeNull()
    await findAriaButtonOrThrow('设置').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('界面语言')

    await findButton('English').trigger('click')
    await flushPromises()

    // 弹窗内：语言说明和分区标题都换成英文
    expect(document.body.textContent).toContain('Choose the interface language')
    expect(findButton('General')).toBeDefined()
    // 弹窗外：活动栏按钮的文案也必须同步更新，而不是等重新挂载
    expect(findAriaButton('Settings')).not.toBeNull()
    expect(findAriaButton('Library')).not.toBeNull()
    expect(findAriaButton('设置')).toBeNull()
    expect(document.documentElement.lang).toBe('en')

    wrapper.unmount()
  })
})
