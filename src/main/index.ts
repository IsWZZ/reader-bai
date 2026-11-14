import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import packageJson from '../../package.json'
import { createRunManager } from './ai-run'
import { createAnnotationStore } from './annotations'
import { createLibraryStore } from './library'
import { readPdfPageText } from './pdf-text'
import { createPluginHost } from './plugins/host'
import { createPluginRuntime } from './plugins/runtime'
import { createPlatformToolRegistry } from './platform-tools'
import { createSettingsStore } from './settings-store'
import { createUserDataPaths, migrateLegacyUserData } from './user-data'
import { createWindow } from './window'
import { registerAiIpc } from './ipc/ai'
import { registerAnnotationsIpc } from './ipc/annotations'
import { registerCacheIpc } from './ipc/cache'
import { registerLibraryIpc } from './ipc/library'
import { registerPluginsIpc } from './ipc/plugins'
import { registerRunsIpc } from './ipc/runs'
import { registerSettingsIpc } from './ipc/settings'
import { confirmToolInvocation, registerToolsIpc } from './ipc/tools'

// 平台外壳：只负责应用生命周期、持久化实例与各领域 IPC 的装配。
// 业务逻辑放在 src/main/<domain>.ts，IPC 注册放在 src/main/ipc/。
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const userData = app.getPath('userData')
  const paths = createUserDataPaths(userData)
  try {
    await migrateLegacyUserData(userData)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(
      '无法迁移用户数据',
      `应用无法把旧数据迁移到 ${paths.dataRoot}，将退出以避免读写不完整的数据。\n\n${message}`
    )
    app.quit()
    return
  }

  const library = createLibraryStore(paths.libraryFile)
  const annotations = createAnnotationStore(paths.annotationsFile)
  const settings = createSettingsStore(paths.settingsFile, paths.papersDirectory)
  const runs = createRunManager()
  const plugins = createPluginHost({
    root: paths.pluginsDirectory,
    stateFile: paths.pluginsStateFile,
    appVersion: packageJson.version
  })

  const tools = createPlatformToolRegistry({
    library,
    annotations,
    readPageText: (paper, page) => readPdfPageText(paper.path, page),
    confirm: confirmToolInvocation
  })
  const runtime = createPluginRuntime({
    hostScript: join(__dirname, 'plugin-host.js'),
    tools,
    getPlugins: () => plugins.runtimePlugins(),
    onChange: (states) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('plugins:runtime-changed', states)
      }
    },
    onLog: (entry) => console.info(`[plugin:${entry.pluginId}] [${entry.level}] ${entry.message}`)
  })

  registerLibraryIpc(library, settings)
  registerAnnotationsIpc(annotations, library)
  registerCacheIpc()
  registerSettingsIpc(settings)
  registerPluginsIpc(plugins, runtime)
  registerRunsIpc(runs)
  registerAiIpc(settings, tools, runs)
  registerToolsIpc(tools)

  createWindow()
  void runtime.refresh()

  app.on('before-quit', () => {
    void runtime.stop()
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
