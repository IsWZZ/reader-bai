import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { setLocale, t, DEFAULT_LOCALE, normalizeLocale } from '@renderer/lib/i18n'
import type {
  AiProfile,
  AiProfilePatch,
  AppLanguage,
  AppSettings,
  AppTheme,
  SettingsPatch
} from '@renderer/types'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  language: DEFAULT_LOCALE,
  ai: { profiles: [], activeId: '' },
  library: { directory: '', autoAnalyze: true },
  keyStorage: 'encrypted'
}

/**
 * 全局设置：主题、界面语言与多份 AI 配置。
 * 其他模块通过 aiProfiles / activeAiProfile 读取当前选中的模型配置。
 */
export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({
    theme: DEFAULT_SETTINGS.theme,
    language: DEFAULT_SETTINGS.language,
    ai: { profiles: [], activeId: '' },
    library: { directory: '', autoAnalyze: true },
    keyStorage: DEFAULT_SETTINGS.keyStorage
  })
  const loaded = ref(false)
  const saving = ref(false)
  const error = ref('')

  const aiProfiles = computed<AiProfile[]>(() => settings.value.ai.profiles)
  /** 只有启用的配置能被选择或用于翻译、对话和元数据解析 */
  const enabledAiProfiles = computed<AiProfile[]>(() =>
    settings.value.ai.profiles.filter((profile) => profile.enabled)
  )
  const libraryDirectory = computed<string>(() => settings.value.library.directory)
  const autoAnalyze = computed<boolean>(() => settings.value.library.autoAnalyze)
  const activeAiProfile = computed<AiProfile | null>(() => {
    const { profiles, activeId } = settings.value.ai
    const active = profiles.find((profile) => profile.id === activeId)
    if (active?.enabled) return active
    return profiles.find((profile) => profile.enabled) ?? null
  })
  const isAiConfigured = computed(() => {
    const profile = activeAiProfile.value
    return Boolean(profile?.baseUrl.trim() && profile.hasApiKey && profile.model.trim())
  })
  const theme = computed<AppTheme>(() => settings.value.theme)
  const language = computed<AppLanguage>(() => settings.value.language)

  const applyTheme = (value: AppTheme): void => {
    const dark = value === 'dark'
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }

  const applyLanguage = (value: AppLanguage): void => {
    setLocale(value)
  }

  const adopt = (next: AppSettings): void => {
    // 主进程只校验语言标签格式；渲染进程负责把未注册的语言归一后再落到 store
    const language = normalizeLocale(next.language)
    settings.value = { ...next, language }
    applyTheme(next.theme)
    applyLanguage(language)
  }

  // 应用启动时加载设置并立即应用主题和语言，避免首屏闪烁
  const initialize = async (): Promise<void> => {
    if (loaded.value) return
    loaded.value = true
    applyTheme(settings.value.theme)
    applyLanguage(settings.value.language)

    const api = window.api
    if (!api) return
    try {
      adopt(await api.getSettings())
    } catch (e) {
      error.value = e instanceof Error ? e.message : t('settings.error.read')
    }
  }

  const persist = async (patch: SettingsPatch): Promise<boolean> => {
    if (saving.value) return false

    const previous = settings.value
    const aiPatch = patch.ai
    // 补丁里没有 apiKey 的配置沿用原来的 hasApiKey；填了新 Key 的视为已配置
    const optimisticProfiles: AiProfile[] = aiPatch?.profiles
      ? aiPatch.profiles.map((profile) => {
          const existing = previous.ai.profiles.find((item) => item.id === profile.id)
          return {
            id: profile.id,
            provider: profile.provider ?? existing?.provider ?? 'openai',
            baseUrl: profile.baseUrl,
            model: profile.model,
            hasApiKey: Boolean(profile.apiKey?.trim()) || (existing?.hasApiKey ?? false),
            enabled: profile.enabled ?? existing?.enabled ?? true
          }
        })
      : previous.ai.profiles.map((profile) => ({ ...profile }))
    // 禁用当前配置或全部禁用时，立即把 activeId 归一到可用的配置
    const requestedActiveId = aiPatch?.activeId ?? previous.ai.activeId
    const activeStillEnabled = optimisticProfiles.some(
      (profile) => profile.id === requestedActiveId && profile.enabled
    )
    const optimisticActiveId = activeStillEnabled
      ? requestedActiveId
      : (optimisticProfiles.find((profile) => profile.enabled)?.id ?? '')
    const optimistic: AppSettings = {
      theme: patch.theme ?? previous.theme,
      language: patch.language ?? previous.language,
      ai: {
        // 只切换 activeId 时也要保留完整列表
        profiles: optimisticProfiles,
        activeId: optimisticActiveId
      },
      library: {
        directory: patch.library?.directory ?? previous.library.directory,
        autoAnalyze: patch.library?.autoAnalyze ?? previous.library.autoAnalyze
      },
      keyStorage: previous.keyStorage
    }
    // 主题和语言需要即时生效，失败时再回滚
    settings.value = optimistic
    applyTheme(optimistic.theme)
    applyLanguage(optimistic.language)

    const api = window.api
    if (!api) {
      settings.value = previous
      applyTheme(previous.theme)
      applyLanguage(previous.language)
      error.value = t('settings.error.noStorage')
      return false
    }

    saving.value = true
    error.value = ''
    try {
      adopt(await api.updateSettings(patch))
      return true
    } catch (e) {
      settings.value = previous
      applyTheme(previous.theme)
      applyLanguage(previous.language)
      error.value = e instanceof Error ? e.message : t('settings.error.save')
      return false
    } finally {
      saving.value = false
    }
  }

  const setTheme = (next: AppTheme): Promise<boolean> => persist({ theme: next })

  /** 只接受注册表里已有的语言；未知标签回退到默认语言 */
  const setLanguage = (next: AppLanguage): Promise<boolean> =>
    persist({ language: normalizeLocale(next) })

  /**
   * 保存整份配置列表。补丁未带 apiKey 的配置由主进程保留原有 Key，
   * 因此编辑时不需要、也无法把已保存的 Key 回填到表单。
   */
  const saveAiProfiles = (profiles: AiProfilePatch[], activeId?: string): Promise<boolean> => {
    const next = profiles.map(({ id, provider, baseUrl, model, apiKey, enabled }) => {
      const entry: AiProfilePatch = {
        id,
        baseUrl: baseUrl.trim(),
        model: model.trim()
      }
      if (provider) entry.provider = provider
      if (enabled !== undefined) entry.enabled = enabled
      const trimmedKey = apiKey?.trim()
      if (trimmedKey) entry.apiKey = trimmedKey
      return entry
    })
    return persist({
      ai: activeId === undefined ? { profiles: next } : { profiles: next, activeId }
    })
  }

  const setActiveAiProfile = (id: string): Promise<boolean> => {
    // 禁用配置不能成为当前模型；主进程也会再校验一次
    if (!aiProfiles.value.some((profile) => profile.id === id && profile.enabled)) {
      return Promise.resolve(false)
    }
    return persist({ ai: { activeId: id } })
  }

  const setLibraryDirectory = (directory: string): Promise<boolean> =>
    persist({ library: { directory: directory.trim() } })

  const setAutoAnalyze = (enabled: boolean): Promise<boolean> =>
    persist({ library: { autoAnalyze: enabled } })

  const clearError = (): void => {
    error.value = ''
  }

  return {
    settings,
    loaded,
    saving,
    error,
    theme,
    language,
    aiProfiles,
    enabledAiProfiles,
    activeAiProfile,
    isAiConfigured,
    libraryDirectory,
    autoAnalyze,
    initialize,
    setTheme,
    setLanguage,
    saveAiProfiles,
    setActiveAiProfile,
    setLibraryDirectory,
    setAutoAnalyze,
    clearError
  }
})
