import { readFile, writeFile } from 'fs/promises'

export interface AnnotationRect {
  // 相对页面宽高的归一化坐标（0~1），缩放后依然对齐
  x: number
  y: number
  width: number
  height: number
}

export interface PaperAnnotation {
  id: string
  type: 'highlight' | 'underline'
  color: string
  page: number
  rects: AnnotationRect[]
  text: string
  createdAt: number
}

export type AnnotationMap = Record<string, PaperAnnotation[]>

export interface AnnotationStore {
  read: () => Promise<AnnotationMap>
  write: (store: AnnotationMap) => Promise<void>
}

export const createAnnotationStore = (annotationsFile: string): AnnotationStore => {
  const read = async (): Promise<AnnotationMap> => {
    try {
      const raw = await readFile(annotationsFile, 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? (parsed as AnnotationMap) : {}
    } catch {
      return {}
    }
  }

  const write = async (store: AnnotationMap): Promise<void> => {
    await writeFile(annotationsFile, JSON.stringify(store, null, 2), 'utf-8')
  }

  return { read, write }
}
