import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface SpaceInfo {
    id: string
    name: string
    createdAt: number
  }

  interface PaperInfo {
    id: string
    /** 展示名称，用户可重命名 */
    title: string
    /** 论文在磁盘上的绝对路径 */
    path: string
    /** 原始文件名（含扩展名） */
    fileName: string
    /** 所属空间，null 表示未分类 */
    spaceId: string | null
    /** 标题来源：file=文件名，metadata=PDF 元数据，user=用户重命名 */
    titleSource: 'file' | 'metadata' | 'user'
    createdAt: number
  }

  interface LibraryState {
    spaces: SpaceInfo[]
    papers: PaperInfo[]
  }

  interface AnnotationRect {
    // 相对页面宽高的归一化坐标（0~1）
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

  interface Api {
    importPaper: (spaceId?: string | null) => Promise<PaperInfo | null>
    listPapers: () => Promise<LibraryState>
    createSpace: (name: string) => Promise<LibraryState>
    renameSpace: (id: string, name: string) => Promise<LibraryState>
    deleteSpace: (id: string) => Promise<LibraryState>
    renamePaper: (id: string, title: string, source: 'metadata' | 'user') => Promise<LibraryState>
    movePaper: (id: string, spaceId: string | null) => Promise<LibraryState>
    removePaper: (id: string) => Promise<LibraryState>
    readPaper: (filePath: string) => Promise<Uint8Array>
    listAnnotations: (filePath: string) => Promise<PaperAnnotation[]>
    addAnnotation: (filePath: string, annotation: PaperAnnotation) => Promise<PaperAnnotation>
    removeAnnotations: (filePath: string, ids: string[]) => Promise<string[]>
  }

  interface Window {
    electron: ElectronAPI
    api: Api | undefined
  }
}
