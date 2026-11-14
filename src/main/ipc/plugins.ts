import { ipcMain } from 'electron'
import type { PluginHost } from '../plugins/host'
import type { PluginRuntime } from '../plugins/runtime'

const MAX_PLUGIN_ID_LENGTH = 100

/**
 * 插件发现、启用状态与扩展宿主状态。
 * setEnabled 会同步重载宿主，避免界面显示已启用但运行状态仍是旧值。
 */
export const registerPluginsIpc = (host: PluginHost, runtime: PluginRuntime): void => {
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
}
