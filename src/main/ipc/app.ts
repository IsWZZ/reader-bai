import { app, ipcMain, session } from 'electron'
import { clearAppData } from '../app-data'
import { clearElectronCaches } from '../cache'
import type { LibraryStore } from '../library'
import type { PluginRuntime } from '../plugins/runtime'
import type { SettingsStore } from '../settings-store'
import type { UserDataPaths } from '../user-data'

export interface AppIpcDependencies {
  paths: UserDataPaths
  library: LibraryStore
  settings: SettingsStore
  runtime: PluginRuntime
}

/** 应用级维护操作：卸载前清理本机数据 */
export const registerAppIpc = ({ paths, library, settings, runtime }: AppIpcDependencies): void => {
  ipcMain.handle('app:uninstall', async () => {
    const { papers } = await library.read()
    const libraryDirectory = await settings.libraryDirectory()

    // 先停插件宿主，避免 Windows 上文件仍被占用
    await runtime.stop()
    await clearAppData({
      dataRoot: paths.dataRoot,
      libraryDirectory,
      paperPaths: papers.map((paper) => paper.path)
    })

    // 数据已经清除，缓存清理失败不应阻止退出
    await Promise.allSettled([
      clearElectronCaches(session.defaultSession),
      session.defaultSession.clearStorageData()
    ])

    // 给 IPC 响应留出返回时间，再退出应用
    setTimeout(() => app.quit(), 200)
  })
}
