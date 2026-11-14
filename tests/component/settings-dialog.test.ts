import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsDialog from '@renderer/components/SettingsDialog.vue'
import { useSettingsStore } from '@renderer/store/settings'
import type { AiProfile, AppSettings, SettingsPatch } from '@renderer/types'

const PROFILE_A: AiProfile = {
  id: 'a',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  hasApiKey: true,
  model: 'model-a',
  enabled: true
}

const PROFILE_B: AiProfile = {
  id: 'b',
  provider: 'openai',
  baseUrl: 'https://api2.example.com/v1',
  hasApiKey: true,
  model: 'model-b',
  enabled: true
}

const PROFILE_ANTHROPIC: AiProfile = {
  id: 'c',
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  hasApiKey: true,
  model: 'claude-test',
  enabled: true
}

/** 表单里填写的草稿：Key 是本次新输入的，不会来自已保存配置 */
interface ProfileDraft {
  baseUrl: string
  model: string
  apiKey: string
}

const DEFAULT_LIBRARY_DIRECTORY = '/tmp/reader-bai-papers'

const makeSettings = (
  settings: Omit<AppSettings, 'library' | 'keyStorage' | 'language'>,
  directory = DEFAULT_LIBRARY_DIRECTORY,
  language = 'zh'
): AppSettings => ({
  ...settings,
  language,
  library: { directory, autoAnalyze: true },
  keyStorage: 'encrypted'
})

const BASE_SETTINGS = makeSettings({
  theme: 'light',
  ai: { profiles: [], activeId: '' }
})

let current: AppSettings

const getSettings = vi.fn<() => Promise<AppSettings>>()
const updateSettings = vi.fn<(patch: SettingsPatch) => Promise<AppSettings>>()
const chooseDirectory = vi.fn<() => Promise<string | null>>()
const clearCache = vi.fn<() => Promise<void>>()
const uninstallApp = vi.fn<() => Promise<{ canceled: boolean }>>()

const installSettings = (settings: AppSettings): void => {
  current = structuredClone(settings)
  getSettings.mockResolvedValue(structuredClone(current))
}

// DialogContent 会 Teleport 到 body，因此用 DOMWrapper 查询真实 DOM
type SettingsSection = 'basic' | 'ai' | 'library' | 'plugins' | 'uninstall'

const mountDialog = async (initialSection?: SettingsSection): Promise<VueWrapper> => {
  // 从关闭切换到打开，watcher 才会重置表单状态
  const wrapper = mount(SettingsDialog, {
    props: { open: false, initialSection },
    attachTo: document.body
  })
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

const openLibrarySection = async (): Promise<DOMWrapper<HTMLButtonElement>> => {
  const button = findButton('存储')
  await button.trigger('click')
  return button
}

const openUninstallSection = async (): Promise<DOMWrapper<HTMLButtonElement>> => {
  const button = findButton('卸载')
  await button.trigger('click')
  return button
}

const fillProfile = async (profile: ProfileDraft): Promise<void> => {
  await findInput('#ai-base-url').setValue(profile.baseUrl)
  await findInput('#ai-model').setValue(profile.model)
  await findInput('#ai-api-key').setValue(profile.apiKey)
}

describe('SettingsDialog', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    getSettings.mockReset()
    updateSettings.mockReset()
    chooseDirectory.mockReset()
    chooseDirectory.mockResolvedValue(null)
    clearCache.mockReset()
    clearCache.mockResolvedValue(undefined)
    uninstallApp.mockReset()
    uninstallApp.mockResolvedValue({ canceled: true })
    installSettings(BASE_SETTINGS)
    updateSettings.mockImplementation(async (patch) => {
      // 模拟主进程：没带 apiKey 的配置保留已保存的 Key
      const profiles: AiProfile[] = patch.ai?.profiles
        ? patch.ai.profiles.map((profile) => {
            const existing = current.ai.profiles.find((item) => item.id === profile.id)
            return {
              id: profile.id,
              provider: profile.provider ?? existing?.provider ?? 'openai',
              baseUrl: profile.baseUrl,
              model: profile.model,
              hasApiKey: Boolean(profile.apiKey) || Boolean(existing?.hasApiKey),
              enabled: profile.enabled ?? existing?.enabled ?? true
            }
          })
        : current.ai.profiles.map((profile) => ({ ...profile }))
      current = {
        theme: patch.theme ?? current.theme,
        language: patch.language ?? current.language,
        ai: {
          profiles,
          activeId: patch.ai?.activeId ?? current.ai.activeId
        },
        library: {
          directory:
            patch.library?.directory === undefined
              ? current.library.directory
              : patch.library.directory || DEFAULT_LIBRARY_DIRECTORY,
          autoAnalyze: patch.library?.autoAnalyze ?? current.library.autoAnalyze
        },
        keyStorage: current.keyStorage
      }
      return structuredClone(current)
    })
    window.api = {
      getSettings,
      updateSettings,
      chooseDirectory,
      clearCache,
      uninstallApp
    } as unknown as Api

    const store = useSettingsStore()
    await store.initialize()
  })

  it('opens on the basic section with appearance and language', async () => {
    const wrapper = await mountDialog()

    // 基础设置为默认分区，不再有独立的外观入口
    expect(findButton('基础设置')).toBeDefined()
    expect(() => findButton('外观')).toThrow()
    // 论文库和存储合并为一个分区，侧栏名称保留「存储」
    expect(findButton('存储')).toBeDefined()
    expect(() => findButton('论文库')).toThrow()
    // 卸载是独立分区，不再放在存储里
    expect(findButton('卸载')).toBeDefined()
    expect(findButton('浅色')).toBeDefined()
    expect(findButton('深色')).toBeDefined()
    expect(findButton('中文')).toBeDefined()
    expect(findButton('English')).toBeDefined()
    expect(document.body.textContent).toContain('界面语言')
    expect(document.body.textContent).toContain('导入时解析论文信息')
    wrapper.unmount()
  })

  it('toggles automatic paper analysis from the basic section', async () => {
    const wrapper = await mountDialog()

    const checkbox = findInput('#auto-analyze-papers')
    expect(checkbox.element.checked).toBe(true)

    await checkbox.setValue(false)
    await flushPromises()

    expect(updateSettings).toHaveBeenCalledWith({ library: { autoAnalyze: false } })
    expect(useSettingsStore().autoAnalyze).toBe(false)

    // 存储分区只负责目录和缓存，不再重复出现解析开关
    await openLibrarySection()
    expect(hasInput('#auto-analyze-papers')).toBe(false)

    wrapper.unmount()
  })

  it('opens the section requested by the caller', async () => {
    const wrapper = await mountDialog('ai')

    expect(document.body.textContent).toContain('还没有配置，点击「新增模型」开始。')
    expect(findButton('新增模型')).toBeDefined()
    wrapper.unmount()
  })

  it('switches the theme from the basic section', async () => {
    const wrapper = await mountDialog()

    await findButton('深色').trigger('click')
    await flushPromises()

    expect(updateSettings).toHaveBeenCalledWith({ theme: 'dark' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(useSettingsStore().theme).toBe('dark')
    wrapper.unmount()
  })

  it('offers only light and dark themes', async () => {
    const wrapper = await mountDialog()

    expect(findButton('浅色')).toBeDefined()
    expect(findButton('深色')).toBeDefined()
    expect(() => findButton('跟随系统')).toThrow()
    expect(() => findButton('黑白')).toThrow()
    wrapper.unmount()
  })

  it('switches the interface language and keeps the choice', async () => {
    const wrapper = await mountDialog()

    expect(document.documentElement.lang).toBe('zh')
    expect(findButton('English').attributes('aria-pressed')).toBe('false')

    await findButton('English').trigger('click')
    await flushPromises()

    expect(updateSettings).toHaveBeenCalledWith({ language: 'en' })
    expect(useSettingsStore().language).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(findButton('English').attributes('aria-pressed')).toBe('true')
    // 整个设置界面切换为英文
    expect(findButton('General')).toBeDefined()
    expect(findButton('Storage')).toBeDefined()
    expect(document.body.textContent).toContain('Choose the interface language')
    expect(document.body.textContent).toContain('Settings')
    wrapper.unmount()
  })

  it('falls back to Chinese when an unsupported language is restored', async () => {
    installSettings(
      makeSettings({ theme: 'light', ai: { profiles: [], activeId: '' } }, undefined, 'fr')
    )
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = await mountDialog()

    expect(useSettingsStore().language).toBe('zh')
    expect(document.documentElement.lang).toBe('zh')
    expect(findButton('中文').attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('warns when the system key store is unavailable', async () => {
    installSettings({
      ...makeSettings({ theme: 'light', ai: { profiles: [], activeId: '' } }),
      keyStorage: 'plaintext'
    })
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = await mountDialog()
    await openAiSection()

    expect(document.body.textContent).toContain('系统安全存储不可用，API Key 将以明文保存')
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

  it('saves a new profile with the selected Anthropic provider', async () => {
    const wrapper = await mountDialog()
    await openAiSection()
    await findButton('新增模型').trigger('click')

    // 默认是 OpenAI 兼容接口
    expect(findButton('OpenAI 兼容').attributes('aria-pressed')).toBe('true')
    expect(findInput('#ai-base-url').attributes('placeholder')).toBe('https://api.openai.com/v1')

    await findButton('Anthropic').trigger('click')

    expect(findButton('Anthropic').attributes('aria-pressed')).toBe('true')
    expect(findInput('#ai-base-url').attributes('placeholder')).toBe('https://api.anthropic.com')
    expect(findInput('#ai-model').attributes('placeholder')).toBe('claude-sonnet-5-5')

    await fillProfile({
      baseUrl: 'https://api.anthropic.com/',
      apiKey: 'sk-ant',
      model: 'claude-test'
    })
    await findButton('保存').trigger('click')
    await flushPromises()

    const patch = updateSettings.mock.calls[0][0]
    expect(patch.ai?.profiles?.[0]).toMatchObject({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-test'
    })
    expect(useSettingsStore().aiProfiles[0]?.provider).toBe('anthropic')
    wrapper.unmount()
  })

  it('opens an existing Anthropic profile with its provider selected', async () => {
    installSettings(
      makeSettings({
        theme: 'light',
        ai: { profiles: [PROFILE_A, PROFILE_ANTHROPIC], activeId: 'a' }
      })
    )
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = await mountDialog()
    await openAiSection()
    await findButtons('编辑')[1].trigger('click')

    expect(findButton('Anthropic').attributes('aria-pressed')).toBe('true')
    expect(findInput('#ai-base-url').element.value).toBe('https://api.anthropic.com')

    await findButton('保存').trigger('click')
    await flushPromises()

    const patch = updateSettings.mock.calls[0][0]
    expect(patch.ai?.profiles?.[1]?.provider).toBe('anthropic')
    wrapper.unmount()
  })

  it('keeps the existing profile when adding a second one', async () => {
    installSettings(makeSettings({ theme: 'light', ai: { profiles: [PROFILE_A], activeId: 'a' } }))
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = await mountDialog()
    await openAiSection()
    expect(document.body.textContent).toContain('model-a · api.example.com')
    expect(document.body.textContent).toContain('使用中')

    await findButton('新增模型').trigger('click')
    await fillProfile({ ...PROFILE_B, apiKey: 'sk-b' })
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
    installSettings(
      makeSettings({ theme: 'light', ai: { profiles: [PROFILE_A, PROFILE_B], activeId: 'b' } })
    )
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = await mountDialog()
    await openAiSection()

    const editButtons = findButtons('编辑')
    expect(editButtons).toHaveLength(2)
    await editButtons[0].trigger('click')

    expect(findInput('#ai-base-url').element.value).toBe('https://api.example.com/v1')
    expect(findInput('#ai-model').element.value).toBe('model-a')
    // 已保存的 Key 不回填到渲染进程
    expect(findInput('#ai-api-key').element.value).toBe('')
    expect(findInput('#ai-api-key').element.getAttribute('placeholder')).toBe(
      '留空表示保持现有 Key'
    )
    expect(document.body.textContent).toContain('编辑模型')
    wrapper.unmount()
  })

  it('updates an existing profile in place', async () => {
    installSettings(makeSettings({ theme: 'light', ai: { profiles: [PROFILE_A], activeId: 'a' } }))
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
    // 没重新填写 Key，补丁里不带 apiKey，主进程会保留原 Key
    expect(patch.ai?.profiles).toEqual([
      {
        id: 'a',
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
        model: 'model-a2',
        enabled: true
      }
    ])
    expect(patch.ai?.activeId).toBe('a')
    expect(document.body.textContent).toContain('model-a2 · api.example.com')
    expect(hasInput('#ai-model')).toBe(false)
    expect(useSettingsStore().aiProfiles[0]?.hasApiKey).toBe(true)
    wrapper.unmount()
  })

  it('sends a newly typed key when editing an existing profile', async () => {
    installSettings(makeSettings({ theme: 'light', ai: { profiles: [PROFILE_A], activeId: 'a' } }))
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = await mountDialog()
    await openAiSection()
    await findButton('编辑').trigger('click')
    await findInput('#ai-api-key').setValue('  sk-rotated  ')
    await findButton('保存').trigger('click')
    await flushPromises()

    const patch = updateSettings.mock.calls[0][0]
    expect(patch.ai?.profiles).toEqual([
      {
        id: 'a',
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
        model: 'model-a',
        apiKey: 'sk-rotated',
        enabled: true
      }
    ])
    wrapper.unmount()
  })

  it('requires an API key when creating a new profile', async () => {
    const wrapper = await mountDialog()
    await openAiSection()
    await findButton('新增模型').trigger('click')

    await findInput('#ai-base-url').setValue('https://api.example.com/v1')
    await findInput('#ai-model').setValue('gpt-test')
    await findButton('保存').trigger('click')
    await flushPromises()

    expect(updateSettings).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('新增配置需要填写 API Key')
    wrapper.unmount()
  })

  it('cancels a new profile without saving', async () => {
    const wrapper = await mountDialog()
    await openAiSection()
    await findButton('新增模型').trigger('click')
    await fillProfile({ ...PROFILE_A, apiKey: 'sk-a' })
    await findButton('取消').trigger('click')
    await flushPromises()

    expect(updateSettings).not.toHaveBeenCalled()
    expect(hasInput('#ai-base-url')).toBe(false)
    expect(useSettingsStore().aiProfiles).toHaveLength(0)
    wrapper.unmount()
  })

  it('disables a profile and moves the active model to another enabled one', async () => {
    installSettings(
      makeSettings({ theme: 'light', ai: { profiles: [PROFILE_A, PROFILE_B], activeId: 'a' } })
    )
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = await mountDialog()
    await openAiSection()

    expect(findButtons('禁用')).toHaveLength(2)
    await findButtons('禁用')[0].trigger('click')
    await flushPromises()

    const patch = updateSettings.mock.calls[0][0]
    expect(patch.ai?.profiles).toEqual([
      expect.objectContaining({ id: 'a', enabled: false }),
      expect.objectContaining({ id: 'b', enabled: true })
    ])
    expect(patch.ai?.activeId).toBe('b')
    expect(useSettingsStore().activeAiProfile?.id).toBe('b')
    // 禁用后可重新启用
    expect(findButton('启用')).toBeDefined()
    expect(document.body.textContent).toContain('已禁用')
    wrapper.unmount()
  })

  it('deletes the active profile and moves the active id to the remaining one', async () => {
    installSettings(
      makeSettings({ theme: 'light', ai: { profiles: [PROFILE_A, PROFILE_B], activeId: 'b' } })
    )
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
    expect(patch.ai?.profiles).toEqual([
      {
        id: 'a',
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
        model: 'model-a',
        enabled: true
      }
    ])
    expect(patch.ai?.activeId).toBe('a')
    expect(document.body.textContent).not.toContain('model-b · api2.example.com')
    wrapper.unmount()
  })

  it('shows the empty state after deleting the last profile', async () => {
    installSettings(makeSettings({ theme: 'light', ai: { profiles: [PROFILE_A], activeId: 'a' } }))
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

  it('shows the current directory in the library section', async () => {
    const wrapper = await mountDialog()
    await openLibrarySection()

    expect(findInput('#library-directory').element.value).toBe(DEFAULT_LIBRARY_DIRECTORY)
    expect(document.body.textContent).toContain('新导入的 PDF 会复制到此目录')
    wrapper.unmount()
  })

  it('saves the directory picked from the native dialog', async () => {
    chooseDirectory.mockResolvedValue('/tmp/custom-papers')
    const wrapper = await mountDialog()
    await openLibrarySection()

    await findButton('选择文件夹').trigger('click')
    await flushPromises()

    expect(chooseDirectory).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({ library: { directory: '/tmp/custom-papers' } })
    expect(findInput('#library-directory').element.value).toBe('/tmp/custom-papers')
    expect(document.body.textContent).toContain('已保存')
    wrapper.unmount()
  })

  it('keeps the directory when the folder dialog is cancelled', async () => {
    const wrapper = await mountDialog()
    await openLibrarySection()

    await findButton('选择文件夹').trigger('click')
    await flushPromises()

    expect(chooseDirectory).toHaveBeenCalledTimes(1)
    expect(updateSettings).not.toHaveBeenCalled()
    expect(findInput('#library-directory').element.value).toBe(DEFAULT_LIBRARY_DIRECTORY)
    wrapper.unmount()
  })

  it('restores the default library directory', async () => {
    installSettings(
      makeSettings({ theme: 'light', ai: { profiles: [], activeId: '' } }, '/tmp/custom-papers')
    )
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = await mountDialog()
    await openLibrarySection()
    expect(findInput('#library-directory').element.value).toBe('/tmp/custom-papers')

    await findButton('恢复默认').trigger('click')
    await flushPromises()

    expect(updateSettings).toHaveBeenCalledWith({ library: { directory: '' } })
    expect(findInput('#library-directory').element.value).toBe(DEFAULT_LIBRARY_DIRECTORY)
    wrapper.unmount()
  })

  it('reports an error when the folder picker is unavailable', async () => {
    window.api = { getSettings, updateSettings } as unknown as Api
    const wrapper = await mountDialog()
    await openLibrarySection()

    await findButton('选择文件夹').trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('当前环境无法选择文件夹')
    expect(updateSettings).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('clears Electron caches from the storage section', async () => {
    const wrapper = await mountDialog()
    await openLibrarySection()

    expect(document.body.textContent).toContain('清除缓存')
    await findButton('清理缓存').trigger('click')
    await flushPromises()

    expect(clearCache).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('缓存已清理')
    wrapper.unmount()
  })

  it('reports a cache clearing failure', async () => {
    clearCache.mockRejectedValueOnce(new Error('缓存清理失败'))
    const wrapper = await mountDialog()
    await openLibrarySection()

    await findButton('清理缓存').trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('缓存清理失败')
    wrapper.unmount()
  })

  it('warns that uninstalling deletes local papers before it runs', async () => {
    const wrapper = await mountDialog()
    await openUninstallSection()

    expect(document.body.textContent).toContain('卸载应用')
    expect(document.body.textContent).toContain(
      '本地论文副本、标注、设置、API Key 和插件都会被永久删除；导入前的原始 PDF 不会被删除。'
    )

    await findButton('卸载并清除数据').trigger('click')
    await flushPromises()

    // 确认由主进程原生弹窗负责；渲染进程只调用窄接口
    expect(uninstallApp).toHaveBeenCalledTimes(1)
    // 用户取消后恢复按钮
    expect(findButton('卸载并清除数据').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps the uninstall button disabled after the user confirms', async () => {
    uninstallApp.mockResolvedValueOnce({ canceled: false })
    const wrapper = await mountDialog()
    await openUninstallSection()

    await findButton('卸载并清除数据').trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('正在清除…')
    expect(findButton('正在清除…').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('reports an uninstall failure', async () => {
    uninstallApp.mockRejectedValueOnce(new Error('无法删除论文文件'))
    const wrapper = await mountDialog()
    await openUninstallSection()

    await findButton('卸载并清除数据').trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('无法删除论文文件')
    expect(findButton('卸载并清除数据').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('reports when uninstalling is unavailable', async () => {
    window.api = { getSettings, updateSettings, chooseDirectory, clearCache } as unknown as Api
    const wrapper = await mountDialog()
    await openUninstallSection()

    await findButton('卸载并清除数据').trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('当前环境无法卸载应用')
    expect(uninstallApp).not.toHaveBeenCalled()
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
    expect(document.body.textContent).toContain('Base URL 需要是 HTTPS 地址')
    // 表单保持展开，方便修改
    expect(hasInput('#ai-base-url')).toBe(true)
    wrapper.unmount()
  })

  it('rejects plain HTTP for remote hosts but allows localhost', async () => {
    const wrapper = await mountDialog()
    await openAiSection()
    await findButton('新增模型').trigger('click')
    await fillProfile({
      baseUrl: 'http://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-test'
    })
    await findButton('保存').trigger('click')
    await flushPromises()

    expect(updateSettings).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Base URL 需要是 HTTPS 地址')

    await findInput('#ai-base-url').setValue('http://localhost:11434/v1')
    await findButton('保存').trigger('click')
    await flushPromises()

    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings.mock.calls[0][0].ai?.profiles?.[0]?.baseUrl).toBe(
      'http://localhost:11434/v1'
    )
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
