import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AiSettings, AppSettings, AppTheme, SettingsPatch } from '@renderer/types'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  ai: { baseUrl: '', apiKey: '' }
}

const systemPrefersDark = (): boolean => window.matchMedia('(prefers-color-scheme: dark)').matches

/**
 * 全局设置：主题与 AI 服务配置。
 * 其他模块通过 useSettingsStore().aiConfig 读取 Base URL / API Key。
 */
export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({
    theme: DEFAULT_SETTINGS.theme,
    ai: { ...DEFAULT_SETTINGS.ai }
  })
  const loaded = ref(false)
  const saving = ref(false)
  const error = ref('')

  const aiConfig = computed<AiSettings>(() => settings.value.ai)
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
    const optimistic: AppSettings = {
      theme: patch.theme ?? previous.theme,
      ai: patch.ai ? { ...patch.ai } : { ...previous.ai }
    }
    // 主题需要即时生效，失败时再回滚
    settings.value = optimistic
    applyTheme(optimistic.theme)

    const api = window.api
    if (!api) {
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

  const saveAi = (ai: AiSettings): Promise<boolean> =>
    persist({ ai: { baseUrl: ai.baseUrl.trim(), apiKey: ai.apiKey.trim() } })

  const clearError = (): void => {
    error.value = ''
  }

  return {
    settings,
    loaded,
    saving,
    error,
    theme,
    aiConfig,
    initialize,
    setTheme,
    saveAi,
    clearError
  }
})
