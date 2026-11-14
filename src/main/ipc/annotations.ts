import { ipcMain } from 'electron'
import { parsePaperAnnotation, type AnnotationStore } from '../annotations'
import type { LibraryStore } from '../library'

const MAX_PATH_LENGTH = 4096
const MAX_REMOVE_IDS = 100
const MAX_ID_LENGTH = 100
const MAX_ANNOTATIONS_PER_PAPER = 5_000

/** 渲染进程传来的路径一律当字符串处理，先做形状校验 */
const readFilePath = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_PATH_LENGTH) {
    throw new Error('论文路径不正确')
  }
  return value
}

const readAnnotationIds = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0) throw new Error('标注 id 列表不正确')
  if (value.length > MAX_REMOVE_IDS) throw new Error(`一次最多删除 ${MAX_REMOVE_IDS} 条标注`)
  return value.map((item) => {
    if (typeof item !== 'string' || !item.trim() || item.trim().length > MAX_ID_LENGTH) {
      throw new Error('标注 id 不正确')
    }
    return item.trim()
  })
}

/** 阅读标注的 IPC，只允许读写论文库中已导入论文的标注 */
export const registerAnnotationsIpc = (
  annotations: AnnotationStore,
  library: LibraryStore
): void => {
  const ensureLibraryPaper = async (filePath: string): Promise<void> => {
    if (!(await library.hasPaperPath(filePath))) {
      throw new Error('Paper not found in library')
    }
  }

  ipcMain.handle('annotations:list', async (_event, rawPath: unknown) => {
    const filePath = readFilePath(rawPath)
    await ensureLibraryPaper(filePath)
    const store = await annotations.read()
    return store[filePath] ?? []
  })

  ipcMain.handle('annotations:add', async (_event, rawPath: unknown, rawAnnotation: unknown) => {
    const filePath = readFilePath(rawPath)
    await ensureLibraryPaper(filePath)
    const annotation = parsePaperAnnotation(rawAnnotation)

    const store = await annotations.read()
    const list = store[filePath] ?? []
    if (list.length >= MAX_ANNOTATIONS_PER_PAPER) throw new Error('该论文的标注数量已达上限')
    if (list.some((item) => item.id === annotation.id)) throw new Error('标注已存在')
    list.push(annotation)
    store[filePath] = list
    await annotations.write(store)
    return annotation
  })

  // 删除某篇论文的多条注释，返回实际删除的 id
  ipcMain.handle('annotations:remove', async (_event, rawPath: unknown, rawIds: unknown) => {
    const filePath = readFilePath(rawPath)
    const ids = readAnnotationIds(rawIds)
    await ensureLibraryPaper(filePath)

    const store = await annotations.read()
    const list = store[filePath] ?? []
    const idSet = new Set(ids)
    const removed = list.filter((annotation) => idSet.has(annotation.id)).map((a) => a.id)
    if (removed.length === 0) return []
    store[filePath] = list.filter((annotation) => !idSet.has(annotation.id))
    await annotations.write(store)
    return removed
  })
}
