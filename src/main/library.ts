import { readFile, writeFile } from 'fs/promises'

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
  path: string
  // 原始文件名（含扩展名）
  fileName: string
  // 所属空间，null 表示未分类
  spaceId: string | null
  // 标题来源：file=文件名，metadata=PDF 元数据，user=用户重命名
  titleSource: PaperTitleSource
  createdAt: number
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
  return {
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
}

// 兼容旧版 library.json（纯论文数组），并补齐新增字段
export const normalizeLibrary = (parsed: unknown): LibraryState => {
  const legacyPapers = Array.isArray(parsed) ? parsed : null
  const state = (parsed && typeof parsed === 'object' ? parsed : {}) as Partial<LibraryState>
  const spaces: SpaceInfo[] = []
  if (!legacyPapers && Array.isArray(state.spaces)) {
    spaces.push(
      ...state.spaces.filter(
        (space): space is SpaceInfo =>
          !!space && typeof space.id === 'string' && typeof space.name === 'string'
      )
    )
  }
  const spaceIds = new Set(spaces.map((space) => space.id))
  const rawPapers = legacyPapers ?? (Array.isArray(state.papers) ? state.papers : [])
  const papers = rawPapers.map(normalizePaper).filter((paper): paper is PaperInfo => paper !== null)
  for (const paper of papers) {
    if (paper.spaceId && !spaceIds.has(paper.spaceId)) paper.spaceId = null
  }
  return { spaces, papers }
}

export interface LibraryStore {
  read: () => Promise<LibraryState>
  write: (state: LibraryState) => Promise<void>
  hasPaperPath: (filePath: string) => Promise<boolean>
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

  return { read, write, hasPaperPath }
}
