import { ipcMain } from 'electron'
import type { PluginHost } from '../plugins/host'

const MAX_PLUGIN_ID_LENGTH = 100

/** 插件发现与启用状态；只暴露渲染进程需要的最小接口，校验留在主进程 */
export const registerPluginsIpc = (host: PluginHost): void => {
  ipcMain.handle('plugins:list', () => host.list())

  ipcMain.handle('plugins:setEnabled', (_event, id: unknown, enabled: unknown) => {
    if (typeof id !== 'string' || !id || id.length > MAX_PLUGIN_ID_LENGTH) {
      throw new Error('插件 id 不正确')
    }
    if (typeof enabled !== 'boolean') throw new Error('启用状态不正确')
    return host.setEnabled(id, enabled)
  })
}
