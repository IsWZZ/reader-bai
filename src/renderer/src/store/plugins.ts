import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PluginInfo, PluginIssue, PluginRuntimeState } from '@renderer/types'
import { t } from '@renderer/lib/i18n'

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback

/** 插件列表、启用状态与扩展宿主状态；写操作仍由主进程校验 */
export const usePluginsStore = defineStore('plugins', () => {
  const plugins = ref<PluginInfo[]>([])
  const issues = ref<PluginIssue[]>([])
  const runtime = ref<PluginRuntimeState[]>([])
  const loading = ref(false)
  const savingId = ref<string | null>(null)
  const error = ref('')

  const load = async (): Promise<void> => {
    const api = window.api
    if (!api?.listPlugins) {
      error.value = t('plugins.error.unsupported')
      return
    }

    loading.value = true
    error.value = ''
    try {
      const result = await api.listPlugins()
      plugins.value = result.plugins
      issues.value = result.issues
    } catch (e) {
      error.value = errorMessage(e, t('plugins.error.load'))
    } finally {
      loading.value = false
    }
  }

  const loadRuntime = async (): Promise<void> => {
    const api = window.api
    if (!api?.getPluginRuntime) return
    try {
      runtime.value = await api.getPluginRuntime()
    } catch {
      // 宿主状态不可用不影响插件列表本身
    }
  }

  const applyRuntime = (states: PluginRuntimeState[]): void => {
    runtime.value = states
  }

  const runtimeFor = (pluginId: string): PluginRuntimeState | undefined =>
    runtime.value.find((state) => state.pluginId === pluginId)

  const setEnabled = async (id: string, enabled: boolean): Promise<boolean> => {
    const api = window.api
    if (!api?.setPluginEnabled) {
      error.value = t('plugins.error.unsupported')
      return false
    }

    savingId.value = id
    error.value = ''
    try {
      const updated = await api.setPluginEnabled(id, enabled)
      plugins.value = plugins.value.map((plugin) => (plugin.id === updated.id ? updated : plugin))
      return true
    } catch (e) {
      error.value = errorMessage(e, t('plugins.error.update'))
      return false
    } finally {
      savingId.value = null
    }
  }

  return {
    plugins,
    issues,
    runtime,
    loading,
    savingId,
    error,
    load,
    loadRuntime,
    applyRuntime,
    runtimeFor,
    setEnabled
  }
})
