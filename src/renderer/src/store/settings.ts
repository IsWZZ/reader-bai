import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AiProfile, AppSettings, AppTheme, SettingsPatch } from '@renderer/types'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  ai: { profiles: [], activeId: '' }
}

const systemPrefersDark = (): boolean => window.matchMedia('(prefers-color-scheme: dark)').matches

/**
 * 全局设置：主题与多份 AI 配置。
 * 其他模块通过 aiProfiles / activeAiProfile 读取当前选中的模型配置。
 */
export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({
    theme: DEFAULT_SETTINGS.theme,
    ai: { profiles: [], activeId: '' }
  })
  const loaded = ref(false)
  const saving = ref(false)
  const error = ref('')

  const aiProfiles = computed<AiProfile[]>(() => settings.value.ai.profiles)
  const activeAiProfile = computed<AiProfile | null>(() => {
    const { profiles, activeId } = settings.value.ai
    return profiles.find((profile) => profile.id === activeId) ?? profiles[0] ?? null
  })
  const isAiConfigured = computed(() => {
    const profile = activeAiProfile.value
    return Boolean(profile?.baseUrl.trim() && profile.apiKey.trim() && profile.model.trim())
  })
  const theme = computed<AppTheme>(() => settings.value.theme)

  let mediaQuery: MediaQueryList | null = null

  const applyTheme = (value: AppTheme): void => {
    const dark = value === 'dark' || (value === 'system' && systemPrefersDark())
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }

  // 跟随系统时监听系统主题切换，只注册一次
  const watchSystemTheme = (): void => {
    if (mediaQuery) return
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', () => {
      if (settings.value.theme === 'system') applyTheme('system')
    })
  }

  const adopt = (next: AppSettings): void => {
    settings.value = next
    watchSystemTheme()
    applyTheme(next.theme)
  }

  // 应用启动时加载设置并立即应用主题，避免明暗闪烁
  const initialize = async (): Promise<void> => {
    if (loaded.value) return
    loaded.value = true
    watchSystemTheme()
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
    const optimistic: AppSettings = {
      theme: patch.theme ?? previous.theme,
      ai: {
        // 只切换 activeId 时也要保留完整列表
        profiles: (aiPatch?.profiles ?? previous.ai.profiles).map((profile) => ({ ...profile })),
        activeId: aiPatch?.activeId ?? previous.ai.activeId
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

  const saveAiProfiles = (profiles: AiProfile[], activeId?: string): Promise<boolean> => {
    const next = profiles.map(({ id, baseUrl, apiKey, model }) => ({
      id,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim()
    }))
    return persist({
      ai: activeId === undefined ? { profiles: next } : { profiles: next, activeId }
    })
  }

  const setActiveAiProfile = (id: string): Promise<boolean> => persist({ ai: { activeId: id } })

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
    initialize,
    setTheme,
    saveAiProfiles,
    setActiveAiProfile,
    clearError
  }
})
