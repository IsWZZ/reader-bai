import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@renderer/store/settings'
import type { AiProfile, AppSettings, SettingsPatch } from '@renderer/types'

const PROFILE_A: AiProfile = {
  id: 'a',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  hasApiKey: true,
  model: 'model-a'
}

const PROFILE_B: AiProfile = {
  id: 'b',
  provider: 'openai',
  baseUrl: 'https://api2.example.com/v1',
  hasApiKey: true,
  model: 'model-b'
}

const DEFAULT_LIBRARY_DIRECTORY = '/tmp/reader-bai-papers'

const makeSettings = (
  settings: Omit<AppSettings, 'library' | 'keyStorage' | 'language'>,
  directory = DEFAULT_LIBRARY_DIRECTORY,
  language = 'zh'
): AppSettings => ({ ...settings, language, library: { directory }, keyStorage: 'encrypted' })

const BASE_SETTINGS = makeSettings({
  theme: 'light',
  ai: { profiles: [], activeId: '' }
})

const getSettings = vi.fn<() => Promise<AppSettings>>()
const updateSettings = vi.fn<(patch: SettingsPatch) => Promise<AppSettings>>()

let current: AppSettings

const clone = (value: AppSettings): AppSettings => structuredClone(value)

const installSettings = (settings: AppSettings): void => {
  current = clone(settings)
  getSettings.mockResolvedValue(clone(current))
}

// 模拟主进程：未提供的字段保持不变；空目录表示恢复默认；没带 Key 的配置保留原 Key
const mergePatch = (patch: SettingsPatch): AppSettings => {
  const profiles: AiProfile[] = patch.ai?.profiles
    ? patch.ai.profiles.map((profile) => {
        const existing = current.ai.profiles.find((item) => item.id === profile.id)
        return {
          id: profile.id,
          provider: profile.provider ?? existing?.provider ?? 'openai',
          baseUrl: profile.baseUrl,
          model: profile.model,
          hasApiKey: Boolean(profile.apiKey) || Boolean(existing?.hasApiKey)
        }
      })
    : current.ai.profiles.map((profile) => ({ ...profile }))
  return {
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
          : patch.library.directory || DEFAULT_LIBRARY_DIRECTORY
    },
    keyStorage: current.keyStorage
  }
}

const installApi = (): void => {
  window.api = { getSettings, updateSettings } as unknown as Api
}

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getSettings.mockReset()
    updateSettings.mockReset()
    installSettings(BASE_SETTINGS)
    updateSettings.mockImplementation(async (patch) => {
      current = mergePatch(patch)
      return clone(current)
    })
    installApi()
  })

  it('loads settings on initialize and exposes the active AI profile', async () => {
    installSettings(
      makeSettings({
        theme: 'dark',
        ai: { profiles: [PROFILE_A, PROFILE_B], activeId: 'b' }
      })
    )
    const store = useSettingsStore()

    await store.initialize()

    expect(store.loaded).toBe(true)
    expect(store.theme).toBe('dark')
    expect(store.aiProfiles).toEqual([PROFILE_A, PROFILE_B])
    expect(store.activeAiProfile).toEqual(PROFILE_B)
    expect(store.isAiConfigured).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('falls back to the first profile when activeId is stale', async () => {
    installSettings(
      makeSettings({ theme: 'light', ai: { profiles: [PROFILE_A], activeId: 'missing' } })
    )
    const store = useSettingsStore()

    await store.initialize()

    expect(store.activeAiProfile).toEqual(PROFILE_A)
  })

  it('reports an incomplete profile and an empty list', async () => {
    installSettings(
      makeSettings({
        theme: 'light',
        ai: { profiles: [{ ...PROFILE_A, hasApiKey: false }], activeId: 'a' }
      })
    )
    const store = useSettingsStore()
    await store.initialize()

    expect(store.isAiConfigured).toBe(false)

    installSettings(BASE_SETTINGS)
    setActivePinia(createPinia())
    const emptyStore = useSettingsStore()
    await emptyStore.initialize()

    expect(emptyStore.activeAiProfile).toBeNull()
    expect(emptyStore.isAiConfigured).toBe(false)
  })

  it('persists theme changes and updates the document class', async () => {
    const store = useSettingsStore()
    await store.initialize()

    const saved = await store.setTheme('dark')

    expect(saved).toBe(true)
    expect(updateSettings).toHaveBeenCalledWith({ theme: 'dark' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(store.theme).toBe('dark')
  })

  it('switches back to light and removes the dark class', async () => {
    const store = useSettingsStore()
    await store.initialize()
    await store.setTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    const saved = await store.setTheme('light')

    expect(saved).toBe(true)
    expect(store.theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('applies the saved language on initialize', async () => {
    installSettings(
      makeSettings({ theme: 'light', ai: { profiles: [], activeId: '' } }, undefined, 'en')
    )
    const store = useSettingsStore()

    await store.initialize()

    expect(store.language).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('normalizes an unsupported saved language to Chinese', async () => {
    installSettings(
      makeSettings({ theme: 'light', ai: { profiles: [], activeId: '' } }, undefined, 'fr-FR')
    )
    const store = useSettingsStore()

    await store.initialize()

    // 主进程保存的是格式合法的标签，渲染进程只认已注册的语言
    expect(store.language).toBe('zh')
    expect(document.documentElement.lang).toBe('zh')
  })

  it('persists language changes and updates the document language', async () => {
    const store = useSettingsStore()
    await store.initialize()
    expect(document.documentElement.lang).toBe('zh')

    const saved = await store.setLanguage('en')

    expect(saved).toBe(true)
    expect(updateSettings).toHaveBeenCalledWith({ language: 'en' })
    expect(store.language).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('normalizes an unsupported language before saving', async () => {
    const store = useSettingsStore()
    await store.initialize()

    const saved = await store.setLanguage('fr')

    expect(saved).toBe(true)
    // 未注册的语言回退到默认中文，并持久化归一后的值
    expect(updateSettings).toHaveBeenCalledWith({ language: 'zh' })
    expect(store.language).toBe('zh')
    expect(document.documentElement.lang).toBe('zh')
  })

  it('rolls back the language when saving fails', async () => {
    updateSettings.mockRejectedValue(new Error('磁盘写入失败'))
    const store = useSettingsStore()
    await store.initialize()

    const saved = await store.setLanguage('en')

    expect(saved).toBe(false)
    expect(store.language).toBe('zh')
    expect(document.documentElement.lang).toBe('zh')
    expect(store.error).toBe('磁盘写入失败')
  })

  it('trims AI profiles and submits profiles with activeId in one patch', async () => {
    const store = useSettingsStore()
    await store.initialize()

    const saved = await store.saveAiProfiles(
      [{ id: 'a', baseUrl: '  https://api.example.com/v1/  ', apiKey: '  sk-a  ', model: '  m  ' }],
      'a'
    )

    expect(saved).toBe(true)
    expect(updateSettings).toHaveBeenCalledWith({
      ai: {
        profiles: [{ id: 'a', baseUrl: 'https://api.example.com/v1/', model: 'm', apiKey: 'sk-a' }],
        activeId: 'a'
      }
    })
    expect(store.aiProfiles[0]).toEqual({
      id: 'a',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1/',
      hasApiKey: true,
      model: 'm'
    })
    expect(store.activeAiProfile?.id).toBe('a')
  })

  it('omits apiKey for unchanged profiles so the stored key is preserved', async () => {
    installSettings(makeSettings({ theme: 'light', ai: { profiles: [PROFILE_A], activeId: 'a' } }))
    const store = useSettingsStore()
    await store.initialize()

    const saved = await store.saveAiProfiles(
      [{ id: 'a', baseUrl: 'https://api.example.com/v2', model: 'model-a2' }],
      'a'
    )

    expect(saved).toBe(true)
    expect(updateSettings).toHaveBeenCalledWith({
      ai: {
        profiles: [{ id: 'a', baseUrl: 'https://api.example.com/v2', model: 'model-a2' }],
        activeId: 'a'
      }
    })
    expect(store.aiProfiles[0]).toEqual({
      id: 'a',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v2',
      hasApiKey: true,
      model: 'model-a2'
    })
  })

  it('sends the selected provider with each profile', async () => {
    const store = useSettingsStore()
    await store.initialize()

    const saved = await store.saveAiProfiles(
      [
        {
          id: 'a',
          provider: 'anthropic',
          baseUrl: ' https://api.anthropic.com ',
          apiKey: ' sk-ant ',
          model: ' claude-test '
        }
      ],
      'a'
    )

    expect(saved).toBe(true)
    expect(updateSettings).toHaveBeenCalledWith({
      ai: {
        profiles: [
          {
            id: 'a',
            provider: 'anthropic',
            baseUrl: 'https://api.anthropic.com',
            model: 'claude-test',
            apiKey: 'sk-ant'
          }
        ],
        activeId: 'a'
      }
    })
    expect(store.aiProfiles[0]).toMatchObject({ provider: 'anthropic', model: 'claude-test' })
  })

  it('marks a profile as configured while its key is being saved', async () => {
    installSettings(makeSettings({ theme: 'light', ai: { profiles: [PROFILE_A], activeId: 'a' } }))
    let resolveUpdate: (value: AppSettings) => void = () => undefined
    updateSettings.mockImplementation(
      () =>
        new Promise<AppSettings>((resolve) => {
          resolveUpdate = resolve
        })
    )
    const store = useSettingsStore()
    await store.initialize()

    const pending = store.saveAiProfiles(
      [{ id: 'a', baseUrl: 'https://api.example.com/v2', model: 'm', apiKey: 'sk-new' }],
      'a'
    )

    // 乐观更新期间立刻显示为已配置
    expect(store.aiProfiles[0]?.hasApiKey).toBe(true)
    expect(store.isAiConfigured).toBe(true)

    resolveUpdate(
      makeSettings({
        theme: 'light',
        ai: {
          profiles: [{ ...PROFILE_A, baseUrl: 'https://api.example.com/v2', model: 'm' }],
          activeId: 'a'
        }
      })
    )
    await expect(pending).resolves.toBe(true)
  })

  it('switches only activeId without dropping the profile list', async () => {
    installSettings(
      makeSettings({ theme: 'light', ai: { profiles: [PROFILE_A, PROFILE_B], activeId: 'a' } })
    )
    let resolveUpdate: (value: AppSettings) => void = () => undefined
    updateSettings.mockImplementation(
      () =>
        new Promise<AppSettings>((resolve) => {
          resolveUpdate = resolve
        })
    )
    const store = useSettingsStore()
    await store.initialize()

    const pending = store.setActiveAiProfile('b')

    expect(updateSettings).toHaveBeenCalledWith({ ai: { activeId: 'b' } })
    // 请求进行中也要保留完整列表
    expect(store.aiProfiles).toEqual([PROFILE_A, PROFILE_B])
    expect(store.activeAiProfile?.id).toBe('b')

    resolveUpdate(
      makeSettings({ theme: 'light', ai: { profiles: [PROFILE_A, PROFILE_B], activeId: 'b' } })
    )
    await expect(pending).resolves.toBe(true)
    expect(store.activeAiProfile?.id).toBe('b')
  })

  it('loads the effective library directory and saves a custom one', async () => {
    const store = useSettingsStore()
    await store.initialize()

    expect(store.libraryDirectory).toBe(DEFAULT_LIBRARY_DIRECTORY)

    const saved = await store.setLibraryDirectory('  /tmp/custom-papers  ')

    expect(saved).toBe(true)
    expect(updateSettings).toHaveBeenCalledWith({ library: { directory: '/tmp/custom-papers' } })
    expect(store.libraryDirectory).toBe('/tmp/custom-papers')
  })

  it('restores the default library directory with an empty patch value', async () => {
    installSettings(
      makeSettings({ theme: 'light', ai: { profiles: [], activeId: '' } }, '/tmp/custom-papers')
    )
    const store = useSettingsStore()
    await store.initialize()
    expect(store.libraryDirectory).toBe('/tmp/custom-papers')

    const saved = await store.setLibraryDirectory('')

    expect(saved).toBe(true)
    expect(updateSettings).toHaveBeenCalledWith({ library: { directory: '' } })
    expect(store.libraryDirectory).toBe(DEFAULT_LIBRARY_DIRECTORY)
  })

  it('rolls back the library directory when saving fails', async () => {
    updateSettings.mockRejectedValue(new Error('目录不可写'))
    const store = useSettingsStore()
    await store.initialize()

    const saved = await store.setLibraryDirectory('/tmp/custom-papers')

    expect(saved).toBe(false)
    expect(store.libraryDirectory).toBe(DEFAULT_LIBRARY_DIRECTORY)
    expect(store.error).toBe('目录不可写')
  })

  it('rolls back the theme when saving fails', async () => {
    installSettings(makeSettings({ theme: 'dark', ai: { profiles: [], activeId: '' } }))
    updateSettings.mockRejectedValue(new Error('磁盘写入失败'))
    const store = useSettingsStore()
    await store.initialize()
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    const saved = await store.setTheme('light')

    expect(saved).toBe(false)
    expect(store.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(store.error).toBe('磁盘写入失败')
  })

  it('records the error and keeps defaults when loading settings fails', async () => {
    getSettings.mockRejectedValue(new Error('配置文件损坏'))
    const store = useSettingsStore()

    await store.initialize()

    expect(store.loaded).toBe(true)
    expect(store.theme).toBe('light')
    expect(store.error).toBe('配置文件损坏')
    expect(store.aiProfiles).toEqual([])
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('only loads settings once', async () => {
    const store = useSettingsStore()

    await store.initialize()
    await store.initialize()

    expect(getSettings).toHaveBeenCalledTimes(1)
  })

  it('rolls back AI profiles when saving fails', async () => {
    updateSettings.mockRejectedValue(new Error('写入失败'))
    const store = useSettingsStore()
    await store.initialize()

    const saved = await store.saveAiProfiles([PROFILE_A], 'a')

    expect(saved).toBe(false)
    expect(store.aiProfiles).toEqual([])
    expect(store.activeAiProfile).toBeNull()
    expect(store.error).toBe('写入失败')
  })

  it('ignores a second save while one is already in flight', async () => {
    let resolveUpdate: (value: AppSettings) => void = () => undefined
    updateSettings.mockImplementation(
      () =>
        new Promise<AppSettings>((resolve) => {
          resolveUpdate = resolve
        })
    )
    const store = useSettingsStore()
    await store.initialize()

    const first = store.setTheme('dark')
    const second = await store.setTheme('light')

    expect(second).toBe(false)
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(store.saving).toBe(true)

    resolveUpdate(makeSettings({ theme: 'dark', ai: { profiles: [], activeId: '' } }))

    await expect(first).resolves.toBe(true)
    expect(store.theme).toBe('dark')
    expect(store.saving).toBe(false)
  })

  it('clears the last error', async () => {
    updateSettings.mockRejectedValue(new Error('写入失败'))
    const store = useSettingsStore()
    await store.initialize()
    await store.setTheme('dark')
    expect(store.error).toBe('写入失败')

    store.clearError()

    expect(store.error).toBe('')
  })

  it('reports an error and keeps the old theme when window.api is missing', async () => {
    window.api = undefined
    const store = useSettingsStore()
    await store.initialize()

    const saved = await store.setTheme('dark')

    expect(saved).toBe(false)
    expect(store.theme).toBe('light')
    expect(store.error).toBe('当前环境无法访问设置存储')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
