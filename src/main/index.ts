import { app, shell, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { normalizeChatMessages, streamChatCompletion } from './ai'
import {
  applySettingsPatch,
  normalizeStoredSettings,
  type AppSettings,
  type SettingsPatch,
  type StoredAiProfile,
  type StoredSettings
} from './settings'

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

interface SpaceInfo {
  id: string
  name: string
  createdAt: number
}

type PaperTitleSource = 'file' | 'metadata' | 'user'

interface PaperInfo {
  id: string
  // 展示名称，用户可重命名
  title: string
  path: string
  // 原始文件名（含扩展名）
  fileName: string
  // 所属空间，null 表示未分类
  spaceId: string | null
  // 标题来源：file=文件名，metadata=PDF 元数据，user=用户重命名
  titleSource: PaperTitleSource
  createdAt: number
}

interface LibraryState {
  spaces: SpaceInfo[]
  papers: PaperInfo[]
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

  const baseName = (filePath: string): string => {
    const normalized = filePath.replace(/\\/g, '/')
    return normalized.split('/').pop() || normalized
  }

  const fileStem = (filePath: string): string => baseName(filePath).replace(/\.pdf$/i, '')

  const createId = (): string =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  const normalizePaper = (raw: unknown): PaperInfo | null => {
    if (!raw || typeof raw !== 'object') return null
    const item = raw as Partial<PaperInfo>
    if (typeof item.path !== 'string' || !item.path) return null
    return {
      id: typeof item.id === 'string' && item.id ? item.id : createId(),
      title: typeof item.title === 'string' && item.title.trim() ? item.title : fileStem(item.path),
      path: item.path,
      fileName:
        typeof item.fileName === 'string' && item.fileName ? item.fileName : baseName(item.path),
      spaceId: typeof item.spaceId === 'string' && item.spaceId ? item.spaceId : null,
      titleSource:
        item.titleSource === 'metadata' || item.titleSource === 'user' ? item.titleSource : 'file',
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now()
    }
  }

  // 兼容旧版 library.json（纯论文数组），并补齐新增字段
  const normalizeLibrary = (parsed: unknown): LibraryState => {
    if (Array.isArray(parsed)) {
      return {
        spaces: [],
        papers: parsed.map(normalizePaper).filter((paper): paper is PaperInfo => paper !== null)
      }
    }
    const state = (parsed && typeof parsed === 'object' ? parsed : {}) as Partial<LibraryState>
    const spaces = Array.isArray(state.spaces)
      ? state.spaces.filter(
          (space): space is SpaceInfo =>
            !!space && typeof space.id === 'string' && typeof space.name === 'string'
        )
      : []
    const spaceIds = new Set(spaces.map((space) => space.id))
    const papers = Array.isArray(state.papers)
      ? state.papers.map(normalizePaper).filter((paper): paper is PaperInfo => paper !== null)
      : []
    for (const paper of papers) {
      if (paper.spaceId && !spaceIds.has(paper.spaceId)) paper.spaceId = null
    }
    return { spaces, papers }
  }

  const readLibrary = async (): Promise<LibraryState> => {
    try {
      const raw = await readFile(libraryFile, 'utf-8')
      return normalizeLibrary(JSON.parse(raw))
    } catch {
      // 文件不存在或内容损坏时返回空列表
      return { spaces: [], papers: [] }
    }
  }

  const writeLibrary = async (state: LibraryState): Promise<void> => {
    await writeFile(libraryFile, JSON.stringify(state, null, 2), 'utf-8')
  }

  // 读取论文库
  ipcMain.handle('library:list', () => readLibrary())

  // 新建空间
  ipcMain.handle('library:createSpace', async (_event, name: unknown) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) throw new Error('空间名称不能为空')
    const state = await readLibrary()
    state.spaces.push({
      id: createId(),
      name: trimmed.slice(0, 60),
      createdAt: Date.now()
    })
    await writeLibrary(state)
    return state
  })

  // 重命名空间
  ipcMain.handle('library:renameSpace', async (_event, id: string, name: unknown) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) throw new Error('空间名称不能为空')
    const state = await readLibrary()
    const space = state.spaces.find((item) => item.id === id)
    if (!space) throw new Error('空间不存在')
    space.name = trimmed.slice(0, 60)
    await writeLibrary(state)
    return state
  })

  // 删除空间，空间内的论文退回未分类
  ipcMain.handle('library:deleteSpace', async (_event, id: string) => {
    const state = await readLibrary()
    const index = state.spaces.findIndex((item) => item.id === id)
    if (index === -1) return state
    state.spaces.splice(index, 1)
    for (const paper of state.papers) {
      if (paper.spaceId === id) paper.spaceId = null
    }
    await writeLibrary(state)
    return state
  })

  // 重命名论文（metadata 来源不会覆盖用户的重命名）
  ipcMain.handle(
    'library:renamePaper',
    async (_event, id: string, title: unknown, source: PaperTitleSource = 'user') => {
      const trimmed = typeof title === 'string' ? title.trim() : ''
      if (!trimmed) throw new Error('论文名称不能为空')
      const state = await readLibrary()
      const paper = state.papers.find((item) => item.id === id)
      if (!paper) throw new Error('论文不存在')
      if (source === 'user' || paper.titleSource !== 'user') {
        paper.title = trimmed.slice(0, 300)
        paper.titleSource = source === 'metadata' ? 'metadata' : 'user'
        await writeLibrary(state)
      }
      return state
    }
  )

  // 把论文移动到某个空间（null 表示移出到未分类）
  ipcMain.handle('library:movePaper', async (_event, id: string, spaceId: string | null) => {
    const state = await readLibrary()
    const paper = state.papers.find((item) => item.id === id)
    if (!paper) throw new Error('论文不存在')
    if (spaceId !== null && !state.spaces.some((space) => space.id === spaceId)) {
      throw new Error('空间不存在')
    }
    paper.spaceId = spaceId
    await writeLibrary(state)
    return state
  })

  // 从论文库移除（不删除磁盘上的文件）
  ipcMain.handle('library:removePaper', async (_event, id: string) => {
    const state = await readLibrary()
    const index = state.papers.findIndex((item) => item.id === id)
    if (index !== -1) {
      state.papers.splice(index, 1)
      await writeLibrary(state)
    }
    return state
  })

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
    const { papers } = await readLibrary()
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

  // 应用设置持久化文件
  const settingsFile = join(app.getPath('userData'), 'settings.json')

  // API Key 优先用系统钥匙串加密；系统不支持时退化为明文存储
  const encodeApiKey = (apiKey: string): { apiKey: string; apiKeyEncrypted: boolean } => {
    if (!apiKey) return { apiKey: '', apiKeyEncrypted: false }
    if (safeStorage.isEncryptionAvailable()) {
      return {
        apiKey: safeStorage.encryptString(apiKey).toString('base64'),
        apiKeyEncrypted: true
      }
    }
    return { apiKey, apiKeyEncrypted: false }
  }

  const decodeApiKey = (profile: StoredAiProfile): string => {
    if (!profile.apiKey) return ''
    if (!profile.apiKeyEncrypted) return profile.apiKey
    try {
      return safeStorage.decryptString(Buffer.from(profile.apiKey, 'base64'))
    } catch {
      // 换了机器或钥匙串不可用时解密会失败，按空 Key 处理
      return ''
    }
  }

  const readStoredSettings = async (): Promise<StoredSettings> => {
    try {
      const raw = await readFile(settingsFile, 'utf-8')
      return normalizeStoredSettings(JSON.parse(raw))
    } catch {
      return normalizeStoredSettings(null)
    }
  }

  const toPublicSettings = (stored: StoredSettings): AppSettings => ({
    theme: stored.theme,
    ai: {
      activeId: stored.ai.activeId,
      profiles: stored.ai.profiles.map((profile) => ({
        id: profile.id,
        baseUrl: profile.baseUrl,
        apiKey: decodeApiKey(profile),
        model: profile.model
      }))
    }
  })

  // 读取应用设置
  ipcMain.handle('settings:get', async () => toPublicSettings(await readStoredSettings()))

  // 更新应用设置，未提供的字段保持不变
  ipcMain.handle('settings:update', async (_event, patch: SettingsPatch) => {
    const stored = applySettingsPatch(await readStoredSettings(), patch, encodeApiKey)
    await writeFile(settingsFile, JSON.stringify(stored, null, 2), 'utf-8')
    return toPublicSettings(stored)
  })

  // 进行中的 AI 请求，按 requestId 索引，供渲染进程中止
  const aiRequests = new Map<string, AbortController>()

  // 流式对话：增量通过 ai:chunk 事件推送，invoke 在结束时返回完整文本
  ipcMain.handle(
    'ai:chat',
    async (event, requestId: unknown, messages: unknown, profileId: unknown) => {
      if (typeof requestId !== 'string' || !requestId || requestId.length > 100) {
        throw new Error('请求标识不正确')
      }
      if (typeof profileId !== 'string' || !profileId || profileId.length > 100) {
        throw new Error('请先在设置中选择 AI 服务')
      }
      const normalized = normalizeChatMessages(messages)

      const stored = await readStoredSettings()
      const profile = stored.ai.profiles.find((item) => item.id === profileId)
      if (!profile) throw new Error('所选 AI 配置不存在，请重新选择')

      const apiKey = decodeApiKey(profile)
      if (!profile.baseUrl || !profile.model) {
        throw new Error('请先补全所选 AI 服务的 Base URL、API Key 和模型')
      }
      if (!apiKey) {
        if (profile.apiKeyEncrypted) throw new Error('API Key 解密失败，请重新填写')
        throw new Error('请先补全所选 AI 服务的 Base URL、API Key 和模型')
      }
      if (!isHttpUrl(profile.baseUrl)) {
        throw new Error('Base URL 需要是以 http:// 或 https:// 开头的地址')
      }

      const controller = new AbortController()
      const abort = (): void => controller.abort()
      aiRequests.set(requestId, controller)
      event.sender.once('destroyed', abort)

      try {
        return await streamChatCompletion({
          baseUrl: profile.baseUrl,
          apiKey,
          model: profile.model,
          messages: normalized,
          signal: controller.signal,
          onDelta: (delta) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('ai:chunk', { requestId, delta })
            }
          }
        })
      } finally {
        event.sender.removeListener('destroyed', abort)
        aiRequests.delete(requestId)
      }
    }
  )

  // 中止指定请求；中止后 ai:chat 会把已收到的内容作为结果返回
  ipcMain.on('ai:abort', (_event, requestId: unknown) => {
    if (typeof requestId === 'string') {
      aiRequests.get(requestId)?.abort()
    }
  })

  // 读取论文文件内容（仅允许读取论文库中已导入的文件）
  ipcMain.handle('paper:read', async (_event, filePath: string) => {
    const { papers } = await readLibrary()
    if (!papers.some((paper) => paper.path === filePath)) {
      throw new Error('Paper not found in library')
    }
    return readFile(filePath)
  })

  // 导入论文文件对话框，可指定导入到某个空间
  ipcMain.handle('dialog:importPaper', async (_event, spaceId: string | null = null) => {
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

    const state = await readLibrary()
    const targetSpaceId =
      spaceId && state.spaces.some((space) => space.id === spaceId) ? spaceId : null

    // 已导入过同一路径的论文时直接返回，避免重复；
    // 如果是通过某个空间的导入按钮触发的，则把论文移动进该空间
    const existing = state.papers.find((paper) => paper.path === filePath)
    if (existing) {
      if (targetSpaceId && existing.spaceId !== targetSpaceId) {
        existing.spaceId = targetSpaceId
        await writeLibrary(state)
      }
      return existing
    }

    // 初始名称先取文件名，渲染进程解析 PDF 元数据后会更新为论文真实标题
    const paper: PaperInfo = {
      id: createId(),
      title: fileStem(filePath),
      path: filePath,
      fileName: baseName(filePath),
      spaceId: targetSpaceId,
      titleSource: 'file',
      createdAt: Date.now()
    }

    state.papers.push(paper)
    await writeLibrary(state)

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
