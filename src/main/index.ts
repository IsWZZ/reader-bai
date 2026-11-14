import { app, BrowserWindow, dialog } from 'electron'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import packageJson from '../../package.json'
import { createAgentRuntime } from './agent/runtime'
import { createAiRequester } from './ai-request'
import { createAnnotationStore } from './annotations'
import { createLibraryStore } from './library'
import { lookupCrossref } from './crossref'
import { createPaperAnalyzer } from './paper-analysis'
import { readPdfIntroText, readPdfPageText } from './pdf-text'
import { createPluginHost } from './plugins/host'
import { createPluginRuntime } from './plugins/runtime'
import { createPlatformToolRegistry } from './platform-tools'
import { createSettingsStore } from './settings-store'
import { createUserDataPaths } from './user-data'
import { createWindow } from './window'
import { registerAgentIpc } from './ipc/agent'
import { registerAiIpc } from './ipc/ai'
import { registerAnnotationsIpc } from './ipc/annotations'
import { registerAppIpc } from './ipc/app'
import { registerCacheIpc } from './ipc/cache'
import { registerLibraryIpc } from './ipc/library'
import { registerPluginsIpc } from './ipc/plugins'
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

  // 提供单独的userData目录
  const userData = app.getPath('userData')
  const paths = createUserDataPaths(userData)
  try {
    await mkdir(paths.dataRoot, { recursive: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(
      '无法创建用户数据目录',
      `应用无法创建 ${paths.dataRoot}，将退出以避免读写不完整的数据。\n\n${message}`
    )
    app.quit()
    return
  }

  // 存的是论文的原始数据 library.json
  const library = createLibraryStore(paths.libraryFile)
  // 存的是论文的批注数据,比如高亮数据 annotations.json
  const annotations = createAnnotationStore(paths.annotationsFile)
  // 阅读本地的设置文件 settings.json
  const settings = createSettingsStore(paths.settingsFile, paths.papersDirectory)
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
  // 单次 AI 请求：渲染进程（翻译）和 agent 宿主共用，Key 只在这里解密
  const requester = createAiRequester(settings, tools)
  // 导入后的元数据解析：读取前几页交给 AI，再用 Crossref 校验补全
  const paperAnalyzer = createPaperAnalyzer({
    settings,
    requester,
    readIntroText: async (filePath) => (await readPdfIntroText(filePath)).text,
    lookup: (input) => lookupCrossref(input)
  })
  // agent loop 跑在独立的 utilityProcess 里；主进程只提供能力、预算和取消
  const agentRuntime = createAgentRuntime({
    hostScript: join(__dirname, 'agent-host.js'),
    requester,
    tools,
    onLog: (message) => console.warn(`[agent] ${message}`)
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

  registerLibraryIpc(library, annotations, settings, paperAnalyzer)
  registerAnnotationsIpc(annotations, library)
  registerAppIpc({ paths, library, settings, runtime })
  registerCacheIpc()
  registerSettingsIpc(settings)
  registerPluginsIpc(plugins, runtime)
  registerAgentIpc(agentRuntime)
  registerAiIpc(requester)
  registerToolsIpc(tools)

  createWindow()
  void runtime.refresh()

  app.on('before-quit', () => {
    void agentRuntime.stop()
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
