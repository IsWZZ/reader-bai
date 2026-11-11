import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

interface PaperInfo {
  id: string
  title: string
  path: string
}

interface AnnotationRect {
  // 相对页面宽高的归一化坐标（0~1），缩放后依然对齐
  x: number
  y: number
  width: number
  height: number
}

interface PaperAnnotation {
  id: string
  type: 'highlight' | 'underline'
  color: string
  page: number
  rects: AnnotationRect[]
  text: string
  createdAt: number
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    //默认的页面宽高
    width: 900,
    height: 670,
    // 控制红绿黄灯
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      devTools: is.dev ? true : false
    }
  })

  console.log('Preload path:', join(__dirname, '../preload/index.js'))

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 打开开发者工具
  // mainWindow.webContents.openDevTools()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // 论文库持久化文件
  const libraryFile = join(app.getPath('userData'), 'library.json')

  const readLibrary = async (): Promise<PaperInfo[]> => {
    try {
      const raw = await readFile(libraryFile, 'utf-8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      // 文件不存在或内容损坏时返回空列表
      return []
    }
  }

  const writeLibrary = async (papers: PaperInfo[]): Promise<void> => {
    await writeFile(libraryFile, JSON.stringify(papers, null, 2), 'utf-8')
  }

  // 读取论文库
  ipcMain.handle('library:list', () => readLibrary())

  // 论文注释（高亮/下划线）持久化文件
  const annotationsFile = join(app.getPath('userData'), 'annotations.json')

  const readAnnotations = async (): Promise<Record<string, PaperAnnotation[]>> => {
    try {
      const raw = await readFile(annotationsFile, 'utf-8')
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  const writeAnnotations = async (store: Record<string, PaperAnnotation[]>): Promise<void> => {
    await writeFile(annotationsFile, JSON.stringify(store, null, 2), 'utf-8')
  }

  const isLibraryPaper = async (filePath: string): Promise<boolean> => {
    const papers = await readLibrary()
    return papers.some((paper) => paper.path === filePath)
  }

  // 读取某篇论文的注释
  ipcMain.handle('annotations:list', async (_event, filePath: string) => {
    const store = await readAnnotations()
    return store[filePath] ?? []
  })

  // 新增一条注释
  ipcMain.handle(
    'annotations:add',
    async (_event, filePath: string, annotation: PaperAnnotation) => {
      if (!(await isLibraryPaper(filePath))) {
        throw new Error('Paper not found in library')
      }
      const store = await readAnnotations()
      const list = store[filePath] ?? []
      list.push(annotation)
      store[filePath] = list
      await writeAnnotations(store)
      return annotation
    }
  )

  // 删除某篇论文的多条注释，返回实际删除的 id
  ipcMain.handle('annotations:remove', async (_event, filePath: string, ids: string[]) => {
    if (!(await isLibraryPaper(filePath))) {
      throw new Error('Paper not found in library')
    }
    const store = await readAnnotations()
    const list = store[filePath] ?? []
    const idSet = new Set(ids)
    const removed = list.filter((annotation) => idSet.has(annotation.id)).map((a) => a.id)
    if (removed.length === 0) return []
    store[filePath] = list.filter((annotation) => !idSet.has(annotation.id))
    await writeAnnotations(store)
    return removed
  })

  // 读取论文文件内容（仅允许读取论文库中已导入的文件）
  ipcMain.handle('paper:read', async (_event, filePath: string) => {
    const papers = await readLibrary()
    if (!papers.some((paper) => paper.path === filePath)) {
      throw new Error('Paper not found in library')
    }
    return readFile(filePath)
  })

  // 导入论文文件对话框
  ipcMain.handle('dialog:importPaper', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const filePath = result.filePaths[0]
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'Unknown'

    // 已导入过同一路径的论文时直接返回，避免重复
    const papers = await readLibrary()
    const existing = papers.find((paper) => paper.path === filePath)
    if (existing) {
      return existing
    }

    const paper: PaperInfo = {
      id: Date.now().toString(),
      title: fileName.replace(/\.pdf$/i, ''),
      path: filePath
    }

    papers.push(paper)
    await writeLibrary(papers)

    return paper
  })

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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
