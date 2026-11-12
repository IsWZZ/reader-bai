import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@renderer/store/settings'
import type { AppSettings, SettingsPatch } from '@renderer/types'

const BASE_SETTINGS: AppSettings = {
  theme: 'system',
  ai: { baseUrl: '', apiKey: '' }
}

const getSettings = vi.fn<() => Promise<AppSettings>>()
const updateSettings = vi.fn<(patch: SettingsPatch) => Promise<AppSettings>>()

const installApi = (): void => {
  window.api = { getSettings, updateSettings } as unknown as Api
}

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getSettings.mockReset()
    updateSettings.mockReset()
    getSettings.mockResolvedValue({ ...BASE_SETTINGS, ai: { ...BASE_SETTINGS.ai } })
    updateSettings.mockImplementation(async (patch) => ({
      theme: patch.theme ?? BASE_SETTINGS.theme,
      ai: patch.ai ?? { ...BASE_SETTINGS.ai }
    }))
    installApi()
  })

  it('loads settings on initialize and applies the stored theme', async () => {
    getSettings.mockResolvedValue({
      theme: 'dark',
      ai: { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' }
    })
    const store = useSettingsStore()

    await store.initialize()

    expect(store.loaded).toBe(true)
    expect(store.theme).toBe('dark')
    expect(store.aiConfig).toEqual({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test'
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
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

  it('follows the system theme while theme is "system"', async () => {
    let dark = false
    const listeners = new Set<() => void>()
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: dark,
          media: query,
          onchange: null,
          addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
          removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
          addListener: (listener: () => void) => listeners.add(listener),
          removeListener: (listener: () => void) => listeners.delete(listener),
          dispatchEvent: () => false
        }) as unknown as MediaQueryList
    )
    const store = useSettingsStore()
    await store.initialize()
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    dark = true
    listeners.forEach((listener) => listener())
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    dark = false
    listeners.forEach((listener) => listener())
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('trims AI settings before saving', async () => {
    const store = useSettingsStore()
    await store.initialize()

    const saved = await store.saveAi({
      baseUrl: '  https://api.example.com/v1/  ',
      apiKey: '  sk-secret  '
    })

    expect(saved).toBe(true)
    expect(updateSettings).toHaveBeenCalledWith({
      ai: { baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-secret' }
    })
    expect(store.aiConfig).toEqual({
      baseUrl: 'https://api.example.com/v1/',
      apiKey: 'sk-secret'
    })
  })

  it('rolls back the theme when saving fails', async () => {
    getSettings.mockResolvedValue({ ...BASE_SETTINGS, theme: 'dark' })
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
    expect(store.theme).toBe('system')
    expect(store.error).toBe('配置文件损坏')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('only loads settings once', async () => {
    const store = useSettingsStore()

    await store.initialize()
    await store.initialize()

    expect(getSettings).toHaveBeenCalledTimes(1)
  })

  it('rolls back AI settings when saving fails', async () => {
    updateSettings.mockRejectedValue(new Error('写入失败'))
    const store = useSettingsStore()
    await store.initialize()

    const saved = await store.saveAi({ baseUrl: 'https://api.example.com', apiKey: 'sk-test' })

    expect(saved).toBe(false)
    expect(store.aiConfig).toEqual({ baseUrl: '', apiKey: '' })
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

    resolveUpdate({ theme: 'dark', ai: { baseUrl: '', apiKey: '' } })

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
    expect(store.theme).toBe('system')
    expect(store.error).toBe('当前环境无法访问设置存储')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
