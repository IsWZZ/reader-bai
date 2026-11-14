import { constants } from 'fs'
import { copyFile, mkdir, readFile, writeFile } from 'fs/promises'
import { isAbsolute, join, relative, sep } from 'path'
import { normalizePaperMetadata, type PaperMetadata } from './paper-metadata'

export type { PaperMetadata, PaperMetadataSource, PaperVenueType } from './paper-metadata'

export interface SpaceInfo {
  id: string
  name: string
  createdAt: number
}

export type PaperTitleSource = 'file' | 'metadata' | 'user'

export interface PaperInfo {
  id: string
  // 展示名称，用户可重命名
  title: string
  // 论文库中保存的绝对路径（可能是导入时复制出的副本）
  path: string
  // 导入时的原始路径，用于重复导入去重；旧数据没有该字段时回退到 path
  sourcePath?: string
  // 原始文件名（含扩展名）
  fileName: string
  // 所属空间，null 表示未分类
  spaceId: string | null
  // 标题来源：file=文件名，metadata=PDF 元数据或 AI 解析，user=用户重命名
  titleSource: PaperTitleSource
  createdAt: number
  // AI / Crossref 解析出的书目信息；旧数据没有该字段
  metadata?: PaperMetadata
}

export interface LibraryState {
  spaces: SpaceInfo[]
  papers: PaperInfo[]
}

export const baseName = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
}

export const fileStem = (filePath: string): string => baseName(filePath).replace(/\.pdf$/i, '')

export const createLibraryId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const normalizePaper = (raw: unknown): PaperInfo | null => {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<PaperInfo>
  if (typeof item.path !== 'string' || !item.path) return null
  const paper: PaperInfo = {
    id: typeof item.id === 'string' && item.id ? item.id : createLibraryId(),
    title: typeof item.title === 'string' && item.title.trim() ? item.title : fileStem(item.path),
    path: item.path,
    fileName:
      typeof item.fileName === 'string' && item.fileName ? item.fileName : baseName(item.path),
    spaceId: typeof item.spaceId === 'string' && item.spaceId ? item.spaceId : null,
    titleSource:
      item.titleSource === 'metadata' || item.titleSource === 'user' ? item.titleSource : 'file',
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now()
  }
  if (typeof item.sourcePath === 'string' && item.sourcePath) {
    paper.sourcePath = item.sourcePath
  }
  const metadata = normalizePaperMetadata(item.metadata)
  if (metadata) paper.metadata = metadata
  return paper
}

// 校验 library.json 结构，补齐缺失字段并丢弃无效条目
export const normalizeLibrary = (parsed: unknown): LibraryState => {
  const state = (parsed && typeof parsed === 'object' ? parsed : {}) as Partial<LibraryState>
  const spaces: SpaceInfo[] = []
  if (Array.isArray(state.spaces)) {
    spaces.push(
      ...state.spaces.filter(
        (space): space is SpaceInfo =>
          !!space && typeof space.id === 'string' && typeof space.name === 'string'
      )
    )
  }
  const spaceIds = new Set(spaces.map((space) => space.id))
  const rawPapers = Array.isArray(state.papers) ? state.papers : []
  const papers = rawPapers.map(normalizePaper).filter((paper): paper is PaperInfo => paper !== null)
  for (const paper of papers) {
    if (paper.spaceId && !spaceIds.has(paper.spaceId)) paper.spaceId = null
  }
  return { spaces, papers }
}

/** 判断文件是否已经位于目标目录内（同目录或子目录） */
export const isInsideDirectory = (directory: string, filePath: string): boolean => {
  const relativePath = relative(directory, filePath)
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  )
}

/**
 * 把导入的 PDF 复制进论文库目录，保留原文件。
 * 文件已在目录内时直接返回原路径；重名时自动追加 (2)、(3)。
 */
export const copyIntoLibraryDirectory = async (
  sourcePath: string,
  directory: string
): Promise<string> => {
  await mkdir(directory, { recursive: true })
  if (isInsideDirectory(directory, sourcePath)) return sourcePath

  const name = baseName(sourcePath)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''

  for (let index = 1; ; index += 1) {
    const destination = join(directory, index === 1 ? name : `${stem} (${index})${extension}`)
    try {
      await copyFile(sourcePath, destination, constants.COPYFILE_EXCL)
      return destination
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }
}

export interface LibraryStore {
  read: () => Promise<LibraryState>
  write: (state: LibraryState) => Promise<void>
  hasPaperPath: (filePath: string) => Promise<boolean>
  /**
   * 串行化的读改写；回调抛错时不写盘。
   * 导入、重命名和 AI 解析可能并发，统一走这里避免互相覆盖。
   */
  mutate: <T>(fn: (state: LibraryState) => Promise<T> | T) => Promise<T>
}

export const createLibraryStore = (libraryFile: string): LibraryStore => {
  const read = async (): Promise<LibraryState> => {
    try {
      const raw = await readFile(libraryFile, 'utf-8')
      return normalizeLibrary(JSON.parse(raw))
    } catch {
      // 文件不存在或内容损坏时返回空列表
      return { spaces: [], papers: [] }
    }
  }

  const write = async (state: LibraryState): Promise<void> => {
    await writeFile(libraryFile, JSON.stringify(state, null, 2), 'utf-8')
  }

  const hasPaperPath = async (filePath: string): Promise<boolean> => {
    const { papers } = await read()
    return papers.some((paper) => paper.path === filePath)
  }

  let queue: Promise<unknown> = Promise.resolve()
  const mutate = <T>(fn: (state: LibraryState) => Promise<T> | T): Promise<T> => {
    const next = queue.then(async () => {
      const state = await read()
      const result = await fn(state)
      await write(state)
      return result
    })
    queue = next.catch(() => undefined)
    return next
  }

  return { read, write, hasPaperPath, mutate }
}
