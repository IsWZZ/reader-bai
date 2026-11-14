import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PluginSettings from '@renderer/components/PluginSettings.vue'
import type { PluginInfo, PluginListResult, PluginRuntimeState } from '@renderer/types'

const PLUGIN: PluginInfo = {
  id: 'reader-bai.arxiv-source',
  name: 'arXiv',
  version: '1.0.0',
  description: 'arXiv 检索源',
  permissions: ['network', 'storage'],
  commands: [{ id: 'search.arxiv', title: '在 arXiv 中查找' }],
  enabled: false,
  compatible: true
}

const listPlugins = vi.fn<() => Promise<PluginListResult>>()
const setPluginEnabled = vi.fn<(id: string, enabled: boolean) => Promise<PluginInfo>>()
const getPluginRuntime = vi.fn<() => Promise<PluginRuntimeState[]>>()
const unsubscribeRuntime = vi.fn()
const onPluginRuntime = vi.fn(() => unsubscribeRuntime)

const installApi = (): void => {
  window.api = {
    listPlugins,
    setPluginEnabled,
    getPluginRuntime,
    onPluginRuntime
  } as unknown as Api
}

const mountSettings = async (): Promise<VueWrapper> => {
  const wrapper = mount(PluginSettings)
  await flushPromises()
  return wrapper
}

const checkbox = (wrapper: VueWrapper, name = 'arXiv'): HTMLInputElement =>
  wrapper.get(`input[aria-label="启用 ${name}"]`).element as HTMLInputElement

beforeEach(() => {
  setActivePinia(createPinia())
  listPlugins.mockReset()
  setPluginEnabled.mockReset()
  getPluginRuntime.mockReset()
  onPluginRuntime.mockReset()
  unsubscribeRuntime.mockClear()
  listPlugins.mockResolvedValue({ plugins: [PLUGIN], issues: [] })
  setPluginEnabled.mockImplementation(async (id, enabled) => ({ ...PLUGIN, id, enabled }))
  getPluginRuntime.mockResolvedValue([])
  onPluginRuntime.mockReturnValue(unsubscribeRuntime)
  installApi()
})

describe('PluginSettings', () => {
  it('lists discovered plugins with permissions and commands', async () => {
    const wrapper = await mountSettings()

    expect(listPlugins).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('arXiv')
    expect(wrapper.text()).toContain('v1.0.0')
    expect(wrapper.text()).toContain('reader-bai.arxiv-source')
    expect(wrapper.text()).toContain('network')
    expect(wrapper.text()).toContain('storage')
    expect(wrapper.text()).toContain('在 arXiv 中查找')
    expect(checkbox(wrapper).checked).toBe(false)
  })

  it('enables a plugin and updates the list', async () => {
    const wrapper = await mountSettings()

    await wrapper.get('input[aria-label="启用 arXiv"]').setValue(true)
    await flushPromises()

    expect(setPluginEnabled).toHaveBeenCalledWith('reader-bai.arxiv-source', true)
    expect(checkbox(wrapper).checked).toBe(true)
  })

  it('restores the checkbox and reports the error when the host rejects', async () => {
    setPluginEnabled.mockRejectedValue(new Error('插件与当前版本不兼容'))
    const wrapper = await mountSettings()

    await wrapper.get('input[aria-label="启用 arXiv"]').setValue(true)
    await flushPromises()

    expect(wrapper.text()).toContain('插件与当前版本不兼容')
    expect(checkbox(wrapper).checked).toBe(false)
  })

  it('disables incompatible plugins', async () => {
    listPlugins.mockResolvedValue({
      plugins: [{ ...PLUGIN, compatible: false }],
      issues: []
    })
    const wrapper = await mountSettings()

    expect(wrapper.text()).toContain('与当前应用版本不兼容，无法启用。')
    expect(checkbox(wrapper).disabled).toBe(true)
  })

  it('shows manifest issues for plugins that could not load', async () => {
    listPlugins.mockResolvedValue({
      plugins: [PLUGIN],
      issues: [{ directoryName: 'broken', message: 'manifest.id 格式不正确' }]
    })
    const wrapper = await mountSettings()

    expect(wrapper.text()).toContain('无法加载的插件')
    expect(wrapper.text()).toContain('broken：manifest.id 格式不正确')
  })

  it('shows the extension host runtime state', async () => {
    getPluginRuntime.mockResolvedValue([{ pluginId: PLUGIN.id, status: 'active' }])
    const wrapper = await mountSettings()

    expect(wrapper.get('[data-testid="plugin-runtime"]').text()).toContain('运行中')
  })

  it('shows activation errors from the extension host', async () => {
    getPluginRuntime.mockResolvedValue([
      { pluginId: PLUGIN.id, status: 'error', message: '插件入口没有导出 activate' }
    ])
    const wrapper = await mountSettings()

    expect(wrapper.get('[data-testid="plugin-runtime"]').text()).toContain('启动失败')
    expect(wrapper.text()).toContain('插件入口没有导出 activate')
  })

  it('shows an empty state when no plugins are installed', async () => {
    listPlugins.mockResolvedValue({ plugins: [], issues: [] })
    const wrapper = await mountSettings()

    expect(wrapper.text()).toContain('还没有发现插件')
  })

  it('reports missing plugin support in the current environment', async () => {
    window.api = {} as Api
    const wrapper = await mountSettings()

    expect(wrapper.text()).toContain('当前环境不支持插件')
  })
})
