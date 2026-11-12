import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsDialog from '@renderer/components/SettingsDialog.vue'
import { useSettingsStore } from '@renderer/store/settings'
import type { AiProfile, AppSettings, SettingsPatch } from '@renderer/types'

const PROFILE_A: AiProfile = {
  id: 'a',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-a',
  model: 'model-a'
}

const PROFILE_B: AiProfile = {
  id: 'b',
  baseUrl: 'https://api2.example.com/v1',
  apiKey: 'sk-b',
  model: 'model-b'
}

const BASE_SETTINGS: AppSettings = {
  theme: 'system',
  ai: { profiles: [], activeId: '' }
}

let current: AppSettings

const getSettings = vi.fn<() => Promise<AppSettings>>()
const updateSettings = vi.fn<(patch: SettingsPatch) => Promise<AppSettings>>()

const installSettings = (settings: AppSettings): void => {
  current = structuredClone(settings)
  getSettings.mockResolvedValue(structuredClone(current))
}

// DialogContent 会 Teleport 到 body，因此用 DOMWrapper 查询真实 DOM
const mountDialog = async (): Promise<VueWrapper> => {
  // 从关闭切换到打开，watcher 才会重置表单状态
  const wrapper = mount(SettingsDialog, { props: { open: false }, attachTo: document.body })
  await flushPromises()
  await wrapper.setProps({ open: true })
  await flushPromises()
  return wrapper
}

const findButtons = (label: string): DOMWrapper<HTMLButtonElement>[] =>
  [...document.body.querySelectorAll('button')]
    .filter((element) => element.textContent?.trim() === label)
    .map((element) => new DOMWrapper(element))

const findButton = (label: string): DOMWrapper<HTMLButtonElement> => {
  const button = findButtons(label)[0]
  if (!button) throw new Error(`button "${label}" not found`)
  return button
}

const findInput = (selector: string): DOMWrapper<HTMLInputElement> => {
  const element = document.body.querySelector<HTMLInputElement>(selector)
  if (!element) throw new Error(`input "${selector}" not found`)
  return new DOMWrapper(element)
}

const hasInput = (selector: string): boolean => document.body.querySelector(selector) !== null

const openAiSection = async (): Promise<DOMWrapper<HTMLButtonElement>> => {
  const button = findButton('AI 服务')
  await button.trigger('click')
  return button
}

const fillProfile = async (profile: AiProfile): Promise<void> => {
  await findInput('#ai-base-url').setValue(profile.baseUrl)
  await findInput('#ai-model').setValue(profile.model)
  await findInput('#ai-api-key').setValue(profile.apiKey)
}

describe('SettingsDialog', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    getSettings.mockReset()
    updateSettings.mockReset()
    installSettings(BASE_SETTINGS)
    updateSettings.mockImplementation(async (patch) => {
      current = {
        theme: patch.theme ?? current.theme,
        ai: {
          profiles: (patch.ai?.profiles ?? current.ai.profiles).map((profile) => ({ ...profile })),
          activeId: patch.ai?.activeId ?? current.ai.activeId
        }
      }
      return structuredClone(current)
    })
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

  it('shows only the add button until the user starts a new profile', async () => {
    const wrapper = await mountDialog()
    await openAiSection()

    expect(document.body.textContent).toContain('还没有配置，点击「新增模型」开始。')
    expect(hasInput('#ai-base-url')).toBe(false)
    expect(findButton('新增模型')).toBeDefined()

    await findButton('新增模型').trigger('click')

    expect(hasInput('#ai-base-url')).toBe(true)
    expect(hasInput('#ai-model')).toBe(true)
    expect(hasInput('#ai-api-key')).toBe(true)
    wrapper.unmount()
  })

  it('adds the first profile and shows it in the list after saving', async () => {
    const wrapper = await mountDialog()
    await openAiSection()
    await findButton('新增模型').trigger('click')
    await fillProfile({
      id: '',
      baseUrl: 'https://api.example.com/v1/',
      apiKey: '  sk-test  ',
      model: '  gpt-test  '
    })
    await findButton('保存').trigger('click')
    await flushPromises()

    expect(updateSettings).toHaveBeenCalledTimes(1)
    const patch = updateSettings.mock.calls[0][0]
    expect(patch.ai?.profiles).toHaveLength(1)
    expect(patch.ai?.profiles?.[0]).toMatchObject({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-test'
    })
    expect(patch.ai?.activeId).toBe(patch.ai?.profiles?.[0].id)

    // 表单收起，保存的配置出现在列表里
    expect(hasInput('#ai-base-url')).toBe(false)
    expect(document.body.textContent).toContain('gpt-test · api.example.com')
    expect(document.body.textContent).toContain('已保存')
    expect(useSettingsStore().aiProfiles).toHaveLength(1)
    wrapper.unmount()
  })

  it('keeps the existing profile when adding a second one', async () => {
    installSettings({ theme: 'system', ai: { profiles: [PROFILE_A], activeId: 'a' } })
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = await mountDialog()
    await openAiSection()
    expect(document.body.textContent).toContain('model-a · api.example.com')
    expect(document.body.textContent).toContain('使用中')

    await findButton('新增模型').trigger('click')
    await fillProfile(PROFILE_B)
    await findButton('保存').trigger('click')
    await flushPromises()

    expect(updateSettings).toHaveBeenCalledTimes(1)
    const patch = updateSettings.mock.calls[0][0]
    expect(patch.ai?.profiles?.map((profile) => profile.model)).toEqual(['model-a', 'model-b'])
    // 当前激活的配置仍然存在，保持激活
    expect(patch.ai?.activeId).toBe('a')
    expect(useSettingsStore().aiProfiles).toHaveLength(2)
    expect(document.body.textContent).toContain('model-b · api2.example.com')
    wrapper.unmount()
  })

  it('opens the edit form with the stored values', async () => {
    installSettings({ theme: 'system', ai: { profiles: [PROFILE_A, PROFILE_B], activeId: 'b' } })
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = await mountDialog()
    await openAiSection()

    const editButtons = findButtons('编辑')
    expect(editButtons).toHaveLength(2)
    await editButtons[0].trigger('click')

    expect(findInput('#ai-base-url').element.value).toBe('https://api.example.com/v1')
    expect(findInput('#ai-model').element.value).toBe('model-a')
    expect(document.body.textContent).toContain('编辑模型')
    wrapper.unmount()
  })

  it('updates an existing profile in place', async () => {
    installSettings({ theme: 'system', ai: { profiles: [PROFILE_A], activeId: 'a' } })
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = await mountDialog()
    await openAiSection()
    await findButton('编辑').trigger('click')
    await findInput('#ai-model').setValue('model-a2')
    await findButton('保存').trigger('click')
    await flushPromises()

    expect(updateSettings).toHaveBeenCalledTimes(1)
    const patch = updateSettings.mock.calls[0][0]
    expect(patch.ai?.profiles).toEqual([{ ...PROFILE_A, model: 'model-a2' }])
    expect(patch.ai?.activeId).toBe('a')
    expect(document.body.textContent).toContain('model-a2 · api.example.com')
    expect(hasInput('#ai-model')).toBe(false)
    wrapper.unmount()
  })

  it('cancels a new profile without saving', async () => {
    const wrapper = await mountDialog()
    await openAiSection()
    await findButton('新增模型').trigger('click')
    await fillProfile(PROFILE_A)
    await findButton('取消').trigger('click')
    await flushPromises()

    expect(updateSettings).not.toHaveBeenCalled()
    expect(hasInput('#ai-base-url')).toBe(false)
    expect(useSettingsStore().aiProfiles).toHaveLength(0)
    wrapper.unmount()
  })

  it('deletes the active profile and moves the active id to the remaining one', async () => {
    installSettings({ theme: 'system', ai: { profiles: [PROFILE_A, PROFILE_B], activeId: 'b' } })
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = await mountDialog()
    await openAiSection()

    const deleteButtons = findButtons('删除')
    expect(deleteButtons).toHaveLength(2)
    await deleteButtons[1].trigger('click')
    await flushPromises()

    expect(updateSettings).toHaveBeenCalledTimes(1)
    const patch = updateSettings.mock.calls[0][0]
    expect(patch.ai?.profiles).toEqual([PROFILE_A])
    expect(patch.ai?.activeId).toBe('a')
    expect(document.body.textContent).not.toContain('model-b · api2.example.com')
    wrapper.unmount()
  })

  it('shows the empty state after deleting the last profile', async () => {
    installSettings({ theme: 'system', ai: { profiles: [PROFILE_A], activeId: 'a' } })
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = await mountDialog()
    await openAiSection()
    await findButton('删除').trigger('click')
    await flushPromises()

    const patch = updateSettings.mock.calls[0][0]
    expect(patch.ai).toEqual({ profiles: [], activeId: '' })
    expect(document.body.textContent).toContain('还没有配置，点击「新增模型」开始。')
    expect(hasInput('#ai-base-url')).toBe(false)
    expect(findButton('新增模型')).toBeDefined()
    wrapper.unmount()
  })

  it('rejects an invalid Base URL without saving', async () => {
    const wrapper = await mountDialog()
    await openAiSection()
    await findButton('新增模型').trigger('click')

    await findInput('#ai-base-url').setValue('ftp://example.com')
    await findButton('保存').trigger('click')
    await flushPromises()

    expect(updateSettings).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Base URL 需要是以 http:// 或 https:// 开头的地址')
    // 表单保持展开，方便修改
    expect(hasInput('#ai-base-url')).toBe(true)
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
