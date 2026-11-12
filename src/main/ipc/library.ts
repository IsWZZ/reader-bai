import { dialog, ipcMain } from 'electron'
import { readFile } from 'fs/promises'
import {
  baseName,
  copyIntoLibraryDirectory,
  createLibraryId,
  fileStem,
  type LibraryStore,
  type PaperInfo,
  type PaperTitleSource
} from '../library'
import type { SettingsStore } from '../settings-store'

/** 论文库与 PDF 文件相关的 IPC */
export const registerLibraryIpc = (library: LibraryStore, settings: SettingsStore): void => {
  ipcMain.handle('library:list', () => library.read())

  ipcMain.handle('library:createSpace', async (_event, name: unknown) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) throw new Error('空间名称不能为空')
    const state = await library.read()
    state.spaces.push({
      id: createLibraryId(),
      name: trimmed.slice(0, 60),
      createdAt: Date.now()
    })
    await library.write(state)
    return state
  })

  ipcMain.handle('library:renameSpace', async (_event, id: string, name: unknown) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) throw new Error('空间名称不能为空')
    const state = await library.read()
    const space = state.spaces.find((item) => item.id === id)
    if (!space) throw new Error('空间不存在')
    space.name = trimmed.slice(0, 60)
    await library.write(state)
    return state
  })

  // 删除空间，空间内的论文退回未分类
  ipcMain.handle('library:deleteSpace', async (_event, id: string) => {
    const state = await library.read()
    const index = state.spaces.findIndex((item) => item.id === id)
    if (index === -1) return state
    state.spaces.splice(index, 1)
    for (const paper of state.papers) {
      if (paper.spaceId === id) paper.spaceId = null
    }
    await library.write(state)
    return state
  })

  // 重命名论文（metadata 来源不会覆盖用户的重命名）
  ipcMain.handle(
    'library:renamePaper',
    async (_event, id: string, title: unknown, source: PaperTitleSource = 'user') => {
      const trimmed = typeof title === 'string' ? title.trim() : ''
      if (!trimmed) throw new Error('论文名称不能为空')
      const state = await library.read()
      const paper = state.papers.find((item) => item.id === id)
      if (!paper) throw new Error('论文不存在')
      if (source === 'user' || paper.titleSource !== 'user') {
        paper.title = trimmed.slice(0, 300)
        paper.titleSource = source === 'metadata' ? 'metadata' : 'user'
        await library.write(state)
      }
      return state
    }
  )

  // 把论文移动到某个空间（null 表示移出到未分类）
  ipcMain.handle('library:movePaper', async (_event, id: string, spaceId: string | null) => {
    const state = await library.read()
    const paper = state.papers.find((item) => item.id === id)
    if (!paper) throw new Error('论文不存在')
    if (spaceId !== null && !state.spaces.some((space) => space.id === spaceId)) {
      throw new Error('空间不存在')
    }
    paper.spaceId = spaceId
    await library.write(state)
    return state
  })

  // 从论文库移除（不删除磁盘上的文件）
  ipcMain.handle('library:removePaper', async (_event, id: string) => {
    const state = await library.read()
    const index = state.papers.findIndex((item) => item.id === id)
    if (index !== -1) {
      state.papers.splice(index, 1)
      await library.write(state)
    }
    return state
  })

  // 读取论文文件内容（仅允许读取论文库中已导入的文件）
  ipcMain.handle('paper:read', async (_event, filePath: string) => {
    if (!(await library.hasPaperPath(filePath))) {
      throw new Error('Paper not found in library')
    }
    return readFile(filePath)
  })

  // 选择论文库存储目录
  ipcMain.handle('dialog:chooseDirectory', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择论文库存储位置',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
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

    const state = await library.read()
    const targetSpaceId =
      spaceId && state.spaces.some((space) => space.id === spaceId) ? spaceId : null

    // 已导入过同一来源的论文时直接返回，避免重复；
    // 如果是通过某个空间的导入按钮触发的，则把论文移动进该空间
    const existing = state.papers.find(
      (paper) => paper.sourcePath === filePath || paper.path === filePath
    )
    if (existing) {
      if (targetSpaceId && existing.spaceId !== targetSpaceId) {
        existing.spaceId = targetSpaceId
        await library.write(state)
      }
      return existing
    }

    // 复制进论文库目录；已有论文不迁移，原文件始终保留
    const directory = await settings.libraryDirectory()
    let storedPath: string
    try {
      storedPath = await copyIntoLibraryDirectory(filePath, directory)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`无法把论文复制到论文库目录：${message}`, { cause: error })
    }

    // 初始名称先取文件名，渲染进程解析 PDF 元数据后会更新为论文真实标题
    const paper: PaperInfo = {
      id: createLibraryId(),
      title: fileStem(filePath),
      path: storedPath,
      sourcePath: filePath,
      fileName: baseName(filePath),
      spaceId: targetSpaceId,
      titleSource: 'file',
      createdAt: Date.now()
    }

    state.papers.push(paper)
    await library.write(state)

    return paper
  })
}
