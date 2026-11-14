import { ipcMain, session } from 'electron'
import { clearElectronCaches } from '../cache'

/** Electron 缓存维护的 IPC */
export const registerCacheIpc = (): void => {
  ipcMain.handle('cache:clear', async () => {
    await clearElectronCaches(session.defaultSession)
  })
}
