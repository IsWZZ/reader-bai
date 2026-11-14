import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import packageJson from '../../package.json'
import { createRunManager } from './ai-run'
import { createAnnotationStore } from './annotations'
import { createLibraryStore } from './library'
import { readPdfPageText } from './pdf-text'
import { createPluginHost } from './plugins/host'
import { createPlatformToolRegistry } from './platform-tools'
import { createSettingsStore } from './settings-store'
import { createWindow } from './window'
import { registerAiIpc } from './ipc/ai'
import { registerAnnotationsIpc } from './ipc/annotations'
import { registerLibraryIpc } from './ipc/library'
import { registerPluginsIpc } from './ipc/plugins'
import { registerRunsIpc } from './ipc/runs'
import { registerSettingsIpc } from './ipc/settings'
import { confirmToolInvocation, registerToolsIpc } from './ipc/tools'

// 平台外壳：只负责应用生命周期、持久化实例与各领域 IPC 的装配。
// 业务逻辑放在 src/main/<domain>.ts，IPC 注册放在 src/main/ipc/。
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const userData = app.getPath('userData')
  const library = createLibraryStore(join(userData, 'library.json'))
  const annotations = createAnnotationStore(join(userData, 'annotations.json'))
  const settings = createSettingsStore(join(userData, 'settings.json'), join(userData, 'papers'))
  const runs = createRunManager()
  const plugins = createPluginHost({
    root: join(userData, 'plugins'),
    stateFile: join(userData, 'plugins.json'),
    appVersion: packageJson.version
  })

  const tools = createPlatformToolRegistry({
    library,
    annotations,
    readPageText: (paper, page) => readPdfPageText(paper.path, page),
    confirm: confirmToolInvocation
  })

  registerLibraryIpc(library, settings)
  registerAnnotationsIpc(annotations, library)
  registerSettingsIpc(settings)
  registerPluginsIpc(plugins)
  registerRunsIpc(runs)
  registerAiIpc(settings, tools, runs)
  registerToolsIpc(tools)

  createWindow()

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
