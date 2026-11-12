import { ipcMain } from 'electron'
import type { AnnotationStore, PaperAnnotation } from '../annotations'
import type { LibraryStore } from '../library'

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

  ipcMain.handle('annotations:list', async (_event, filePath: string) => {
    const store = await annotations.read()
    return store[filePath] ?? []
  })

  ipcMain.handle(
    'annotations:add',
    async (_event, filePath: string, annotation: PaperAnnotation) => {
      await ensureLibraryPaper(filePath)
      const store = await annotations.read()
      const list = store[filePath] ?? []
      list.push(annotation)
      store[filePath] = list
      await annotations.write(store)
      return annotation
    }
  )

  // 删除某篇论文的多条注释，返回实际删除的 id
  ipcMain.handle('annotations:remove', async (_event, filePath: string, ids: string[]) => {
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
