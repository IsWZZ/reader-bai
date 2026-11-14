import { lstat, rm, unlink } from 'fs/promises'
import { isInsideDirectory } from './library'

const isNotFound = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'

/**
 * 只删除论文库目录内、且已登记为论文的普通文件。
 * 导入前的原始 PDF 和目录里的其他文件保持不动；符号链接和目录一律跳过，
 * 避免通过论文记录删掉论文库之外的内容。
 */
export const managedPaperFiles = (libraryDirectory: string, paperPaths: string[]): string[] => {
  const files = new Set<string>()
  for (const file of paperPaths) {
    if (typeof file !== 'string' || !file) continue
    if (!isInsideDirectory(libraryDirectory, file)) continue
    files.add(file)
  }
  return [...files]
}

export interface ClearAppDataOptions {
  /** userData/Userdata，包含设置、书库、标注、插件和默认论文目录 */
  dataRoot: string
  /** 当前生效的论文库目录，可能是用户自定义目录 */
  libraryDirectory: string
  paperPaths: string[]
}

/**
 * 卸载前清除应用数据：先删除论文库目录中已登记的论文副本，再删除整个 dataRoot。
 * 自定义论文库目录只删登记过的文件，不删除目录本身，避免误伤用户的其他文件。
 * 返回实际删除的论文文件数量。
 */
export const clearAppData = async ({
  dataRoot,
  libraryDirectory,
  paperPaths
}: ClearAppDataOptions): Promise<number> => {
  let deleted = 0

  for (const file of managedPaperFiles(libraryDirectory, paperPaths)) {
    let stats
    try {
      stats = await lstat(file)
    } catch (error) {
      if (isNotFound(error)) continue
      throw new Error('无法访问论文文件，请关闭占用该文件的应用后重试', { cause: error })
    }
    if (!stats.isFile()) continue

    try {
      await unlink(file)
      deleted += 1
    } catch (error) {
      if (!isNotFound(error)) {
        throw new Error('无法删除论文文件，请关闭占用该文件的应用后重试', { cause: error })
      }
    }
  }

  try {
    await rm(dataRoot, { recursive: true, force: true })
  } catch (error) {
    throw new Error('无法清除应用数据，请关闭占用相关文件的应用后重试', { cause: error })
  }

  return deleted
}

export interface UninstallSummary {
  paperCount: number
  libraryDirectory: string
}

/** 原生确认框的详细文案；必须明确告知本地论文会被删除 */
export const buildUninstallDialogDetail = ({
  paperCount,
  libraryDirectory
}: UninstallSummary): string =>
  `将永久删除本地保存的论文副本（当前 ${paperCount} 篇）、全部标注、设置、API Key 和插件。\n\n论文库目录：${libraryDirectory}\n\n导入前的原始 PDF 不会被删除。此操作不可撤销，完成后应用将退出。`

export const UNINSTALL_DIALOG_TITLE = '卸载并清除数据'

export const UNINSTALL_DIALOG_MESSAGE = '这会删除本机上的论文、标注和全部设置'

export interface UninstallDialogOptions {
  type: 'warning'
  buttons: string[]
  defaultId: number
  cancelId: number
  noLink: boolean
  title: string
  message: string
  detail: string
}

/** 原生确认框参数；默认按钮是取消，必须明确选择才会继续 */
export const buildUninstallDialogOptions = (summary: UninstallSummary): UninstallDialogOptions => ({
  type: 'warning' as const,
  buttons: ['取消', '卸载并清除'],
  defaultId: 0,
  cancelId: 0,
  noLink: true,
  title: UNINSTALL_DIALOG_TITLE,
  message: UNINSTALL_DIALOG_MESSAGE,
  detail: buildUninstallDialogDetail(summary)
})
