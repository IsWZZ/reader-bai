import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PluginInfo, PluginIssue } from '@renderer/types'

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback

/** 插件列表与启用状态；写操作仍由主进程校验，这里只做乐观更新和错误展示 */
export const usePluginsStore = defineStore('plugins', () => {
  const plugins = ref<PluginInfo[]>([])
  const issues = ref<PluginIssue[]>([])
  const loading = ref(false)
  const savingId = ref<string | null>(null)
  const error = ref('')

  const load = async (): Promise<void> => {
    const api = window.api
    if (!api?.listPlugins) {
      error.value = '当前环境不支持插件'
      return
    }

    loading.value = true
    error.value = ''
    try {
      const result = await api.listPlugins()
      plugins.value = result.plugins
      issues.value = result.issues
    } catch (e) {
      error.value = errorMessage(e, '加载插件失败')
    } finally {
      loading.value = false
    }
  }

  const setEnabled = async (id: string, enabled: boolean): Promise<boolean> => {
    const api = window.api
    if (!api?.setPluginEnabled) {
      error.value = '当前环境不支持插件'
      return false
    }

    savingId.value = id
    error.value = ''
    try {
      const updated = await api.setPluginEnabled(id, enabled)
      plugins.value = plugins.value.map((plugin) => (plugin.id === updated.id ? updated : plugin))
      return true
    } catch (e) {
      error.value = errorMessage(e, '更新插件状态失败')
      return false
    } finally {
      savingId.value = null
    }
  }

  return { plugins, issues, loading, savingId, error, load, setEnabled }
})
