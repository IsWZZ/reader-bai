import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface PaperInfo {
    id: string
    title: string
    path: string
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
    importPaper: () => Promise<PaperInfo | null>
    listPapers: () => Promise<PaperInfo[]>
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
