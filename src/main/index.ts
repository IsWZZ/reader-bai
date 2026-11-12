import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createAnnotationStore } from './annotations'
import { createLibraryStore } from './library'
import { createSettingsStore } from './settings-store'
import { createWindow } from './window'
import { registerAiIpc } from './ipc/ai'
import { registerAnnotationsIpc } from './ipc/annotations'
import { registerLibraryIpc } from './ipc/library'
import { registerSettingsIpc } from './ipc/settings'

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

  registerLibraryIpc(library, settings)
  registerAnnotationsIpc(annotations, library)
  registerSettingsIpc(settings)
  registerAiIpc(settings)

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
