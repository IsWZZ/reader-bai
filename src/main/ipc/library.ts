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
import type { PaperAnalyzer } from '../paper-analysis'
import type { AnnotationStore } from '../annotations'
import type { SettingsStore } from '../settings-store'

const MAX_PAPER_ID = 200

const readPaperId = (value: unknown): string => {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || id.length > MAX_PAPER_ID) throw new Error('论文不存在')
  return id
}

/** 论文库与 PDF 文件相关的 IPC */
export const registerLibraryIpc = (
  library: LibraryStore,
  annotations: AnnotationStore,
  settings: SettingsStore,
  analyzer?: PaperAnalyzer
): void => {
  ipcMain.handle('library:list', () => library.read())

  ipcMain.handle('library:createSpace', async (_event, name: unknown) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) throw new Error('空间名称不能为空')
    return library.mutate((state) => {
      state.spaces.push({
        id: createLibraryId(),
        name: trimmed.slice(0, 60),
        createdAt: Date.now()
      })
      return state
    })
  })

  ipcMain.handle('library:renameSpace', async (_event, id: string, name: unknown) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) throw new Error('空间名称不能为空')
    return library.mutate((state) => {
      const space = state.spaces.find((item) => item.id === id)
      if (!space) throw new Error('空间不存在')
      space.name = trimmed.slice(0, 60)
      return state
    })
  })

  // 删除空间，空间内的论文退回未分类
  ipcMain.handle('library:deleteSpace', async (_event, id: string) => {
    return library.mutate((state) => {
      const index = state.spaces.findIndex((item) => item.id === id)
      if (index === -1) return state
      state.spaces.splice(index, 1)
      for (const paper of state.papers) {
        if (paper.spaceId === id) paper.spaceId = null
      }
      return state
    })
  })

  // 重命名论文（metadata 来源不会覆盖用户的重命名）
  ipcMain.handle(
    'library:renamePaper',
    async (_event, id: string, title: unknown, source: PaperTitleSource = 'user') => {
      const trimmed = typeof title === 'string' ? title.trim() : ''
      if (!trimmed) throw new Error('论文名称不能为空')
      return library.mutate((state) => {
        const paper = state.papers.find((item) => item.id === id)
        if (!paper) throw new Error('论文不存在')
        if (source === 'user' || paper.titleSource !== 'user') {
          paper.title = trimmed.slice(0, 300)
          paper.titleSource = source === 'metadata' ? 'metadata' : 'user'
        }
        return state
      })
    }
  )

  // 把论文移动到某个空间（null 表示移出到未分类）
  ipcMain.handle('library:movePaper', async (_event, id: string, spaceId: string | null) => {
    return library.mutate((state) => {
      const paper = state.papers.find((item) => item.id === id)
      if (!paper) throw new Error('论文不存在')
      if (spaceId !== null && !state.spaces.some((space) => space.id === spaceId)) {
        throw new Error('空间不存在')
      }
      paper.spaceId = spaceId
      return state
    })
  })

  // 从论文库移除（不删除磁盘上的文件），并清空该论文的标注
  ipcMain.handle('library:removePaper', async (_event, id: string) => {
    const result = await library.mutate((state) => {
      const index = state.papers.findIndex((item) => item.id === id)
      if (index === -1) return { state, removedPath: null }
      const [paper] = state.papers.splice(index, 1)
      return { state, removedPath: paper.path }
    })
    if (result.removedPath) {
      // 标注以论文路径为键；书库记录删除后 hasPaperPath 不再放行，不清理就永远访问不到
      try {
        await annotations.removePaper(result.removedPath)
      } catch (error) {
        // 书库记录已经删除，不因标注清理失败让界面停在旧状态
        console.error('清理论文标注失败', error)
      }
    }
    return result.state
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
    const directory = await settings.libraryDirectory()

    // 去重、复制和写入放在同一个串行区间里，避免并发导入互相覆盖书库文件
    return library.mutate(async (state) => {
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
        }
        return existing
      }

      // 复制进论文库目录；已有论文不迁移，原文件始终保留
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
      return paper
    })
  })

  // 解析论文元数据：AI 读取 PDF 前几页，再用 Crossref 校验补全
  ipcMain.handle('library:analyzePaper', async (_event, id: unknown, options: unknown) => {
    if (!analyzer) throw new Error('当前环境不支持 AI 解析')
    const paperId = readPaperId(id)
    const useWeb =
      !options || typeof options !== 'object' || (options as { useWeb?: unknown }).useWeb !== false

    const state = await library.read()
    const paper = state.papers.find((item) => item.id === paperId)
    if (!paper) throw new Error('论文不存在')

    // 解析可能需要几十秒，不占用书库写锁；写回时再按最新状态校验
    const metadata = await analyzer.analyze(
      {
        id: paper.id,
        path: paper.path,
        title: paper.titleSource === 'user' ? undefined : paper.title
      },
      { useWeb }
    )

    return library.mutate((next) => {
      const target = next.papers.find((item) => item.id === paperId)
      if (!target) throw new Error('论文不存在')
      target.metadata = metadata
      // 用户手动改过的标题优先；文件名/PDF 元数据标题可以被 AI 结果替换
      if (metadata.title && target.titleSource !== 'user') {
        target.title = metadata.title.slice(0, 300)
        target.titleSource = 'metadata'
      }
      return { ...target }
    })
  })
}
