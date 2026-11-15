import { ipcMain } from 'electron'
import type { PluginHost } from '../plugins/host'
import type { PluginRuntime } from '../plugins/runtime'
import type { PluginViewBridge } from '../plugins/view-bridge'

const MAX_PLUGIN_ID_LENGTH = 100
const MAX_VIEW_ID_LENGTH = 100
const MAX_METHOD_LENGTH = 50

/**
 * 插件发现、启用状态与扩展宿主状态。
 * setEnabled 会同步重载宿主，避免界面显示已启用但运行状态仍是旧值。
 */
export const registerPluginsIpc = (
  host: PluginHost,
  runtime: PluginRuntime,
  viewBridge: PluginViewBridge
): void => {
  ipcMain.handle('plugins:list', () => host.list())

  ipcMain.handle('plugins:runtime', () => runtime.snapshot())

  ipcMain.handle('plugins:setEnabled', async (_event, id: unknown, enabled: unknown) => {
    if (typeof id !== 'string' || !id || id.length > MAX_PLUGIN_ID_LENGTH) {
      throw new Error('插件 id 不正确')
    }
    if (typeof enabled !== 'boolean') throw new Error('启用状态不正确')

    const status = await host.setEnabled(id, enabled)
    await runtime.refresh()
    return status
  })

  // 插件 iframe 的唯一能力入口；权限和工具边界都在主进程校验
  ipcMain.handle(
    'plugins:view-request',
    async (_event, pluginId: unknown, viewId: unknown, method: unknown, params: unknown) => {
      if (typeof pluginId !== 'string' || !pluginId || pluginId.length > MAX_PLUGIN_ID_LENGTH) {
        throw new Error('插件 id 不正确')
      }
      if (typeof viewId !== 'string' || !viewId || viewId.length > MAX_VIEW_ID_LENGTH) {
        throw new Error('视图 id 不正确')
      }
      if (typeof method !== 'string' || !method || method.length > MAX_METHOD_LENGTH) {
        throw new Error('请求方法不正确')
      }
      return viewBridge.request(pluginId, viewId, method, params)
    }
  )
}
