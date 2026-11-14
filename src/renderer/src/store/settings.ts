import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  AiProfile,
  AiProfilePatch,
  AppSettings,
  AppTheme,
  SettingsPatch
} from '@renderer/types'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  ai: { profiles: [], activeId: '' },
  library: { directory: '' }
}

/**
 * 全局设置：主题与多份 AI 配置。
 * 其他模块通过 aiProfiles / activeAiProfile 读取当前选中的模型配置。
 */
export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({
    theme: DEFAULT_SETTINGS.theme,
    ai: { profiles: [], activeId: '' },
    library: { directory: '' }
  })
  const loaded = ref(false)
  const saving = ref(false)
  const error = ref('')

  const aiProfiles = computed<AiProfile[]>(() => settings.value.ai.profiles)
  const libraryDirectory = computed<string>(() => settings.value.library.directory)
  const activeAiProfile = computed<AiProfile | null>(() => {
    const { profiles, activeId } = settings.value.ai
    return profiles.find((profile) => profile.id === activeId) ?? profiles[0] ?? null
  })
  const isAiConfigured = computed(() => {
    const profile = activeAiProfile.value
    return Boolean(profile?.baseUrl.trim() && profile.hasApiKey && profile.model.trim())
  })
  const theme = computed<AppTheme>(() => settings.value.theme)

  const applyTheme = (value: AppTheme): void => {
    const dark = value === 'dark'
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }

  const adopt = (next: AppSettings): void => {
    settings.value = next
    applyTheme(next.theme)
  }

  // 应用启动时加载设置并立即应用主题，避免明暗闪烁
  const initialize = async (): Promise<void> => {
    if (loaded.value) return
    loaded.value = true
    applyTheme(settings.value.theme)

    const api = window.api
    if (!api) return
    try {
      adopt(await api.getSettings())
    } catch (e) {
      error.value = e instanceof Error ? e.message : '读取设置失败'
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
            baseUrl: profile.baseUrl,
            model: profile.model,
            hasApiKey: Boolean(profile.apiKey?.trim()) || (existing?.hasApiKey ?? false)
          }
        })
      : previous.ai.profiles.map((profile) => ({ ...profile }))
    const optimistic: AppSettings = {
      theme: patch.theme ?? previous.theme,
      ai: {
        // 只切换 activeId 时也要保留完整列表
        profiles: optimisticProfiles,
        activeId: aiPatch?.activeId ?? previous.ai.activeId
      },
      library: {
        directory: patch.library?.directory ?? previous.library.directory
      }
    }
    // 主题需要即时生效，失败时再回滚
    settings.value = optimistic
    applyTheme(optimistic.theme)

    const api = window.api
    if (!api) {
      settings.value = previous
      applyTheme(previous.theme)
      error.value = '当前环境无法访问设置存储'
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
      error.value = e instanceof Error ? e.message : '保存设置失败'
      return false
    } finally {
      saving.value = false
    }
  }

  const setTheme = (next: AppTheme): Promise<boolean> => persist({ theme: next })

  /**
   * 保存整份配置列表。补丁未带 apiKey 的配置由主进程保留原有 Key，
   * 因此编辑时不需要、也无法把已保存的 Key 回填到表单。
   */
  const saveAiProfiles = (profiles: AiProfilePatch[], activeId?: string): Promise<boolean> => {
    const next = profiles.map(({ id, baseUrl, model, apiKey }) => {
      const entry: AiProfilePatch = {
        id,
        baseUrl: baseUrl.trim(),
        model: model.trim()
      }
      const trimmedKey = apiKey?.trim()
      if (trimmedKey) entry.apiKey = trimmedKey
      return entry
    })
    return persist({
      ai: activeId === undefined ? { profiles: next } : { profiles: next, activeId }
    })
  }

  const setActiveAiProfile = (id: string): Promise<boolean> => persist({ ai: { activeId: id } })

  const setLibraryDirectory = (directory: string): Promise<boolean> =>
    persist({ library: { directory: directory.trim() } })

  const clearError = (): void => {
    error.value = ''
  }

  return {
    settings,
    loaded,
    saving,
    error,
    theme,
    aiProfiles,
    activeAiProfile,
    isAiConfigured,
    libraryDirectory,
    initialize,
    setTheme,
    saveAiProfiles,
    setActiveAiProfile,
    setLibraryDirectory,
    clearError
  }
})
